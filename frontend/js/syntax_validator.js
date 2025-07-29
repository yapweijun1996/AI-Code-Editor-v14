/**
 * Enhanced Syntax Validation and Code Analysis Module
 * Provides comprehensive validation and analysis for multiple languages
 */

class SyntaxValidator {
    constructor() {
        this.parsers = new Map();
        this.validationCache = new Map();
        this.initializeParsers();
    }

    initializeParsers() {
        // Language detection mapping
        this.languageMap = {
            'js': 'javascript',
            'jsx': 'javascript', 
            'mjs': 'javascript',
            'ts': 'typescript',
            'tsx': 'typescript',
            'css': 'css',
            'scss': 'scss',
            'sass': 'sass',
            'less': 'less',
            'html': 'html',
            'htm': 'html',
            'json': 'json',
            'py': 'python',
            'sql': 'sql',
            'md': 'markdown',
            'yaml': 'yaml',
            'yml': 'yaml'
        };
    }

    /**
     * Comprehensive syntax validation
     */
    async validateSyntax(filename, content) {
        const cacheKey = `${filename}:${this.hashContent(content)}`;
        if (this.validationCache.has(cacheKey)) {
            return this.validationCache.get(cacheKey);
        }

        const extension = filename.split('.').pop()?.toLowerCase();
        const language = this.languageMap[extension];
        
        if (!language) {
            return { valid: true, language: 'unknown', warnings: ['Unknown file type - skipping validation'] };
        }

        let result;
        try {
            switch (language) {
                case 'javascript':
                    result = await this.validateJavaScript(content, extension === 'jsx');
                    break;
                case 'typescript':
                    result = await this.validateTypeScript(content, extension === 'tsx');
                    break;
                case 'python':
                    result = await this.validatePython(content);
                    break;
                case 'json':
                    result = await this.validateJSON(content);
                    break;
                case 'css':
                case 'scss':
                case 'sass':
                case 'less':
                    result = await this.validateCSS(content, language);
                    break;
                case 'html':
                    result = await this.validateHTML(content);
                    break;
                case 'sql':
                    result = await this.validateSQL(content);
                    break;
                default:
                    result = { valid: true, language, warnings: ['Basic validation only'] };
            }
        } catch (error) {
            result = {
                valid: false,
                language,
                errors: [{ line: 1, message: `Validation error: ${error.message}` }],
                suggestions: ['Check syntax manually']
            };
        }

        // Cache result for 5 minutes
        this.validationCache.set(cacheKey, result);
        setTimeout(() => this.validationCache.delete(cacheKey), 5 * 60 * 1000);

        return result;
    }

    /**
     * JavaScript/JSX validation using Monaco and Acorn
     */
    async validateJavaScript(content, isJSX = false) {
        const errors = [];
        const warnings = [];
        const suggestions = [];

        try {
            // Use Monaco for real-time validation
            const model = monaco.editor.createModel(
                content, 
                isJSX ? 'javascript' : 'javascript'
            );
            
            await new Promise(resolve => setTimeout(resolve, 200));
            const markers = monaco.editor.getModelMarkers({ resource: model.uri });
            
            markers.forEach(marker => {
                const item = {
                    line: marker.startLineNumber,
                    column: marker.startColumn,
                    message: marker.message,
                    severity: marker.severity
                };

                if (marker.severity === monaco.MarkerSeverity.Error) {
                    errors.push(item);
                } else if (marker.severity === monaco.MarkerSeverity.Warning) {
                    warnings.push(item);
                }
            });

            model.dispose();

            // Additional Acorn parsing for deeper analysis
            try {
                const ast = acorn.parse(content, {
                    ecmaVersion: 'latest',
                    sourceType: 'module',
                    allowReturnOutsideFunction: true,
                    locations: true
                });

                // Analyze common issues
                this.analyzeCommonJSIssues(ast, content, warnings, suggestions);

            } catch (acornError) {
                if (errors.length === 0) { // Only add if Monaco didn't catch it
                    errors.push({
                        line: acornError.loc?.line || 1,
                        column: acornError.loc?.column || 1,
                        message: `Parse error: ${acornError.message}`
                    });
                }
            }

        } catch (error) {
            errors.push({ line: 1, message: `Validation failed: ${error.message}` });
        }

        return {
            valid: errors.length === 0,
            language: 'javascript',
            errors,
            warnings,
            suggestions: suggestions.length > 0 ? suggestions : this.getJSSuggestions(errors)
        };
    }

    /**
     * TypeScript validation
     */
    async validateTypeScript(content, isTSX = false) {
        // For now, treat as JavaScript but add TS-specific suggestions
        const result = await this.validateJavaScript(content, isTSX);
        result.language = 'typescript';
        
        if (!result.valid) {
            result.suggestions.push(
                'Consider checking TypeScript configuration',
                'Verify type imports and declarations'
            );
        }

        return result;
    }

    /**
     * JSON validation
     */
    async validateJSON(content) {
        try {
            JSON.parse(content);
            return {
                valid: true,
                language: 'json',
                warnings: [],
                suggestions: []
            };
        } catch (error) {
            const lineMatch = error.message.match(/line (\d+)/);
            const line = lineMatch ? parseInt(lineMatch[1]) : 1;

            return {
                valid: false,
                language: 'json',
                errors: [{
                    line,
                    message: error.message
                }],
                suggestions: [
                    'Check for missing commas, quotes, or brackets',
                    'Validate JSON structure with a formatter'
                ]
            };
        }
    }

    /**
     * Python syntax validation
     */
    async validatePython(content) {
        // Basic Python syntax checks
        const errors = [];
        const warnings = [];
        const lines = content.split('\n');

        // Check indentation consistency
        let prevIndent = 0;
        const indentStack = [0];

        lines.forEach((line, index) => {
            if (line.trim() === '') return;

            const indent = line.match(/^\s*/)[0].length;
            const trimmed = line.trim();

            // Check for mixed tabs and spaces
            if (line.match(/^\t/) && line.match(/^ /)) {
                warnings.push({
                    line: index + 1,
                    message: 'Mixed tabs and spaces in indentation'
                });
            }

            // Check for basic syntax patterns
            if (trimmed.includes('print ') && !trimmed.includes('print(')) {
                warnings.push({
                    line: index + 1,
                    message: 'Consider using print() function for Python 3'
                });
            }
        });

        return {
            valid: errors.length === 0,
            language: 'python',
            errors,
            warnings,
            suggestions: errors.length > 0 ? [
                'Check Python syntax and indentation',
                'Verify function definitions and control structures'
            ] : []
        };
    }

    /**
     * SQL validation
     */
    async validateSQL(content) {
        const errors = [];
        const warnings = [];
        const suggestions = [];

        // Basic SQL syntax checks
        const sqlKeywords = /\b(SELECT|FROM|WHERE|JOIN|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|INDEX)\b/gi;
        const lines = content.split('\n');

        lines.forEach((line, index) => {
            const trimmed = line.trim().toLowerCase();
            
            // Check for common SQL issues
            if (trimmed.includes('select *') && trimmed.includes('where')) {
                warnings.push({
                    line: index + 1,
                    message: 'Consider specifying column names instead of SELECT *'
                });
            }

            // Check for SQL injection patterns
            if (trimmed.match(/['"][^'"]*\+[^'"]*['"]/)) {
                warnings.push({
                    line: index + 1,
                    message: 'Potential SQL injection risk - use parameterized queries'
                });
            }
        });

        return {
            valid: true, // Basic validation only
            language: 'sql',
            errors,
            warnings,
            suggestions: warnings.length > 0 ? [
                'Review SQL best practices',
                'Consider using parameterized queries'
            ] : []
        };
    }

    /**
     * CSS validation
     */
    async validateCSS(content, language) {
        const errors = [];
        const warnings = [];
        
        // Basic CSS syntax validation
        const braceCount = (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length;
        if (braceCount !== 0) {
            errors.push({
                line: 1,
                message: `Unmatched braces: ${Math.abs(braceCount)} ${braceCount > 0 ? 'opening' : 'closing'} brace(s)`
            });
        }

        return {
            valid: errors.length === 0,
            language,
            errors,
            warnings,
            suggestions: errors.length > 0 ? ['Check CSS syntax and brace matching'] : []
        };
    }

    /**
     * HTML validation
     */
    async validateHTML(content) {
        const errors = [];
        const warnings = [];

        // Basic HTML validation
        const parser = new DOMParser();
        const doc = parser.parseFromString(content, 'text/html');
        const parserErrors = doc.querySelectorAll('parsererror');

        if (parserErrors.length > 0) {
            parserErrors.forEach(error => {
                errors.push({
                    line: 1,
                    message: error.textContent
                });
            });
        }

        return {
            valid: errors.length === 0,
            language: 'html',
            errors,
            warnings,
            suggestions: errors.length > 0 ? ['Check HTML tag structure and syntax'] : []
        };
    }

    /**
     * Analyze common JavaScript issues
     */
    analyzeCommonJSIssues(ast, content, warnings, suggestions) {
        const lines = content.split('\n');
        
        acorn.walk.simple(ast, {
            // Check for potential issues
            VariableDeclarator(node) {
                if (node.id.name && node.id.name.length === 1) {
                    warnings.push({
                        line: node.loc.start.line,
                        message: `Consider using descriptive variable name instead of '${node.id.name}'`
                    });
                }
            },
            
            FunctionDeclaration(node) {
                if (node.params.length > 5) {
                    warnings.push({
                        line: node.loc.start.line,
                        message: `Function '${node.id.name}' has many parameters (${node.params.length}). Consider using an options object.`
                    });
                }
            }
        });
    }

    /**
     * Get JavaScript-specific suggestions
     */
    getJSSuggestions(errors) {
        const suggestions = [];
        
        errors.forEach(error => {
            if (error.message.includes('Unexpected token')) {
                suggestions.push('Check for missing semicolons, commas, or brackets');
            }
            if (error.message.includes('is not defined')) {
                suggestions.push('Check variable declarations and imports');
            }
            if (error.message.includes('Unexpected end of input')) {
                suggestions.push('Check for unclosed brackets, braces, or parentheses');
            }
        });

        if (suggestions.length === 0) {
            suggestions.push('Review JavaScript syntax and structure');
        }

        return [...new Set(suggestions)]; // Remove duplicates
    }

    /**
     * Hash content for caching
     */
    hashContent(content) {
        let hash = 0;
        for (let i = 0; i < content.length; i++) {
            const char = content.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Clear validation cache
     */
    clearCache() {
        this.validationCache.clear();
    }
}

// Export singleton instance
export const syntaxValidator = new SyntaxValidator();