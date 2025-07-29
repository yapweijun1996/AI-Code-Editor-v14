/**
 * Provider-Specific Optimization Module
 * Optimizes AI interactions based on provider capabilities and limitations
 */

import { performanceOptimizer } from './performance_optimizer.js';

class ProviderOptimizer {
    constructor() {
        this.providerLimits = {
            openai: {
                maxTokens: 4096,
                contextWindow: 128000,
                supportsStructuredOutput: true,
                rateLimit: 3000, // requests per minute
                bestForComplexReasoning: true,
                supportsVision: true
            },
            gemini: {
                maxTokens: 8192,
                contextWindow: 1000000, // 1M tokens
                supportsStructuredOutput: false,
                rateLimit: 1500,
                bestForLargeContext: true,
                supportsVision: true
            },
            ollama: {
                maxTokens: 2048,
                contextWindow: 32000,
                supportsStructuredOutput: false,
                rateLimit: null, // Local, no rate limit
                bestForPrivacy: true,
                supportsVision: false
            }
        };
        
        this.contextCache = performanceOptimizer.createSmartCache(50, 10 * 60 * 1000); // 10 minutes
        this.optimizationStrategies = new Map();
        
        this.initializeStrategies();
    }

    initializeStrategies() {
        // OpenAI optimization strategies
        this.optimizationStrategies.set('openai', {
            prepareContext: this.optimizeForOpenAI.bind(this),
            chunkStrategy: 'semantic',
            prioritizeRecent: true,
            useStructuredPrompts: true,
            maxContextRatio: 0.7 // Use 70% of context window
        });

        // Gemini optimization strategies
        this.optimizationStrategies.set('gemini', {
            prepareContext: this.optimizeForGemini.bind(this),
            chunkStrategy: 'large_chunks',
            prioritizeRecent: false,
            useStructuredPrompts: false,
            maxContextRatio: 0.9 // Can use 90% of large context window
        });

        // Ollama optimization strategies
        this.optimizationStrategies.set('ollama', {
            prepareContext: this.optimizeForOllama.bind(this),
            chunkStrategy: 'small_chunks',
            prioritizeRecent: true,
            useStructuredPrompts: false,
            maxContextRatio: 0.6 // Conservative for local processing
        });
    }

    /**
     * Main optimization entry point
     */
    async optimizeForProvider(provider, context, task = 'general') {
        const cacheKey = `${provider}:${task}:${this.hashContext(context)}`;
        
        if (this.contextCache.has(cacheKey)) {
            return this.contextCache.get(cacheKey);
        }

        let optimizedContext;
        
        switch (provider) {
            case 'openai':
                optimizedContext = await this.optimizeForOpenAI(context, task);
                break;
            case 'gemini':
                optimizedContext = await this.optimizeForGemini(context, task);
                break;
            case 'ollama':
                optimizedContext = await this.optimizeForOllama(context, task);
                break;
            default:
                optimizedContext = await this.optimizeGeneric(context, task);
        }

        this.contextCache.set(cacheKey, optimizedContext);
        return optimizedContext;
    }

    /**
     * OpenAI-specific optimizations
     */
    async optimizeForOpenAI(context, task) {
        const limits = this.providerLimits.openai;
        
        const optimization = {
            provider: 'openai',
            originalSize: this.estimateTokens(context),
            optimizations: []
        };

        // Use structured outputs for complex tasks
        if (task === 'code_analysis' || task === 'refactoring') {
            context.useStructuredOutput = true;
            context.format = 'json_schema';
            optimization.optimizations.push('structured_output');
        }

        // Prioritize recent context for coding tasks
        if (task === 'coding' && context.files) {
            context.files = this.prioritizeRecentFiles(context.files);
            optimization.optimizations.push('recent_file_priority');
        }

        // Chunk large files for better processing
        if (context.files) {
            context.files = await this.chunkFilesForProvider(context.files, limits.maxTokens * 0.7);
            optimization.optimizations.push('file_chunking');
        }

        // Optimize system prompt
        context.systemPrompt = this.createOptimizedSystemPrompt(context.systemPrompt, 'openai', task);
        optimization.optimizations.push('system_prompt_optimization');

        // Add reasoning enhancement
        if (task === 'debugging' || task === 'problem_solving') {
            context.enableChainOfThought = true;
            optimization.optimizations.push('chain_of_thought');
        }

        optimization.finalSize = this.estimateTokens(context);
        optimization.compressionRatio = optimization.originalSize / optimization.finalSize;

        context._optimization = optimization;
        return context;
    }

    /**
     * Gemini-specific optimizations
     */
    async optimizeForGemini(context, task) {
        const limits = this.providerLimits.gemini;
        
        const optimization = {
            provider: 'gemini',
            originalSize: this.estimateTokens(context),
            optimizations: []
        };

        // Leverage large context window
        if (context.files && context.files.length > 10) {
            context.includeFullContext = true;
            context.maxFiles = 50; // Can handle more files
            optimization.optimizations.push('large_context_utilization');
        }

        // Use multi-turn conversation for complex tasks
        if (task === 'code_review' || task === 'architecture_analysis') {
            context.useMultiTurn = true;
            context.conversationHistory = this.prepareConversationHistory(context);
            optimization.optimizations.push('multi_turn_conversation');
        }

        // Optimize for Gemini's strength in understanding relationships
        if (task === 'code_comprehension') {
            context.includeProjectStructure = true;
            context.emphasizeRelationships = true;
            optimization.optimizations.push('relationship_emphasis');
        }

        // Less aggressive chunking due to large context window
        if (context.files) {
            context.files = await this.chunkFilesForProvider(context.files, limits.maxTokens * 0.9);
            optimization.optimizations.push('minimal_chunking');
        }

        // Gemini-optimized system prompt
        context.systemPrompt = this.createOptimizedSystemPrompt(context.systemPrompt, 'gemini', task);
        optimization.optimizations.push('gemini_prompt_optimization');

        optimization.finalSize = this.estimateTokens(context);
        optimization.compressionRatio = optimization.originalSize / optimization.finalSize;

        context._optimization = optimization;
        return context;
    }

    /**
     * Ollama-specific optimizations
     */
    async optimizeForOllama(context, task) {
        const limits = this.providerLimits.ollama;
        
        const optimization = {
            provider: 'ollama',
            originalSize: this.estimateTokens(context),
            optimizations: []
        };

        // Aggressive context reduction for local processing
        if (context.files) {
            context.files = context.files.slice(0, 5); // Limit to 5 files max
            context.files = await this.chunkFilesForProvider(context.files, limits.maxTokens * 0.5);
            optimization.optimizations.push('aggressive_context_reduction');
        }

        // Simplify system prompts for local models
        context.systemPrompt = this.simplifyPromptForLocal(context.systemPrompt);
        optimization.optimizations.push('simplified_prompt');

        // Focus on most relevant content
        if (context.searchResults) {
            context.searchResults = context.searchResults.slice(0, 3);
            optimization.optimizations.push('limited_search_results');
        }

        // Use simpler task instructions
        context.taskInstructions = this.simplifyInstructions(context.taskInstructions);
        optimization.optimizations.push('simplified_instructions');

        // Prefer step-by-step approach
        context.preferStepByStep = true;
        optimization.optimizations.push('step_by_step_processing');

        optimization.finalSize = this.estimateTokens(context);
        optimization.compressionRatio = optimization.originalSize / optimization.finalSize;

        context._optimization = optimization;
        return context;
    }

    /**
     * Generic optimization for unknown providers
     */
    async optimizeGeneric(context, task) {
        // Apply conservative optimizations
        if (context.files && context.files.length > 10) {
            context.files = context.files.slice(0, 10);
        }

        if (context.files) {
            context.files = await this.chunkFilesForProvider(context.files, 2048);
        }

        return context;
    }

    /**
     * Chunk files based on provider capabilities
     */
    async chunkFilesForProvider(files, maxTokensPerChunk) {
        const chunkedFiles = [];
        
        for (const file of files) {
            if (!file.content) continue;
            
            const estimatedTokens = this.estimateTokens(file.content);
            
            if (estimatedTokens > maxTokensPerChunk) {
                // Split large files into chunks
                const chunks = await this.createSemanticChunks(file.content, maxTokensPerChunk);
                
                chunks.forEach((chunk, index) => {
                    chunkedFiles.push({
                        ...file,
                        path: `${file.path}#chunk-${index + 1}`,
                        content: chunk,
                        isChunk: true,
                        originalPath: file.path,
                        chunkIndex: index + 1,
                        totalChunks: chunks.length
                    });
                });
            } else {
                chunkedFiles.push(file);
            }
        }
        
        return chunkedFiles;
    }

    /**
     * Create semantic chunks that preserve code structure
     */
    async createSemanticChunks(content, maxTokens) {
        const lines = content.split('\n');
        const chunks = [];
        let currentChunk = [];
        let currentTokens = 0;
        let inFunction = false;
        let braceCount = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineTokens = this.estimateTokens(line);
            
            // Track code structure
            const trimmed = line.trim();
            if (trimmed.includes('function') || trimmed.includes('class') || trimmed.includes('{')) {
                inFunction = true;
                braceCount += (line.match(/\{/g) || []).length;
            }
            braceCount -= (line.match(/\}/g) || []).length;
            
            if (inFunction && braceCount <= 0) {
                inFunction = false;
            }

            // Check if adding this line would exceed the limit
            if (currentTokens + lineTokens > maxTokens && currentChunk.length > 0) {
                // If we're in the middle of a function, try to complete it
                if (inFunction && braceCount > 0 && currentChunk.length < lines.length * 0.8) {
                    // Continue until function ends or we reach 80% of remaining lines
                    currentChunk.push(line);
                    currentTokens += lineTokens;
                } else {
                    // Create chunk
                    chunks.push(currentChunk.join('\n'));
                    currentChunk = [line];
                    currentTokens = lineTokens;
                }
            } else {
                currentChunk.push(line);
                currentTokens += lineTokens;
            }
        }

        // Add the last chunk
        if (currentChunk.length > 0) {
            chunks.push(currentChunk.join('\n'));
        }

        return chunks;
    }

    /**
     * Prioritize recent files based on modification time or access
     */
    prioritizeRecentFiles(files) {
        return files.sort((a, b) => {
            // Prefer files that were recently modified or accessed
            const aScore = (a.lastModified || 0) + (a.accessCount || 0) * 1000;
            const bScore = (b.lastModified || 0) + (b.accessCount || 0) * 1000;
            return bScore - aScore;
        });
    }

    /**
     * Create optimized system prompts
     */
    createOptimizedSystemPrompt(basePrompt, provider, task) {
        let optimized = basePrompt || '';

        switch (provider) {
            case 'openai':
                if (task === 'coding') {
                    optimized += '\\n\\nFocus on providing precise, implementable solutions. Use structured thinking and break down complex problems step by step.';
                }
                break;

            case 'gemini':
                if (task === 'code_analysis') {
                    optimized += '\\n\\nLeverage your ability to understand complex relationships and provide comprehensive analysis considering the full context.';
                }
                break;

            case 'ollama':
                // Keep prompts simple and direct for local models
                optimized = this.simplifyPromptForLocal(optimized);
                break;
        }

        return optimized;
    }

    /**
     * Simplify prompts for local models
     */
    simplifyPromptForLocal(prompt) {
        if (!prompt) return '';
        
        // Remove complex instructions and use simpler language
        return prompt
            .replace(/\b(comprehensive|sophisticated|nuanced|intricate)\b/gi, '')
            .replace(/\b(analyze thoroughly|provide detailed analysis)\b/gi, 'analyze')
            .replace(/\b(consider all aspects)\b/gi, 'consider')
            .split('.')
            .slice(0, 3) // Keep only first 3 sentences for simplicity
            .join('.')
            .trim();
    }

    /**
     * Simplify task instructions
     */
    simplifyInstructions(instructions) {
        if (!instructions) return '';
        
        return instructions
            .split('\\n')
            .filter(line => line.trim().length > 0)
            .slice(0, 5) // Keep only first 5 instructions
            .map(line => line.replace(/^[-*]\\s*/, '').trim())
            .join('\\n');
    }

    /**
     * Prepare conversation history for multi-turn
     */
    prepareConversationHistory(context) {
        if (!context.history) return [];
        
        // Keep last 5 exchanges for context
        return context.history
            .slice(-10) // Last 10 messages (5 exchanges)
            .map(msg => ({
                role: msg.role,
                content: msg.content.slice(0, 1000) // Limit message length
            }));
    }

    /**
     * Estimate token count (rough approximation)
     */
    estimateTokens(text) {
        if (!text) return 0;
        
        // Rough estimation: 1 token ≈ 4 characters for English
        // More accurate for code would be ~3.5 characters per token
        return Math.ceil(text.length / 3.5);
    }

    /**
     * Hash context for caching
     */
    hashContext(context) {
        const str = JSON.stringify(context, (key, value) => {
            // Exclude dynamic properties from hash
            if (key.startsWith('_') || key === 'timestamp') return undefined;
            return value;
        });
        
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return hash.toString();
    }

    /**
     * Get provider recommendations based on task
     */
    getProviderRecommendation(task, contextSize, requirements = {}) {
        const recommendations = [];

        // OpenAI recommendations
        if (requirements.needsStructuredOutput || task === 'complex_reasoning') {
            recommendations.push({
                provider: 'openai',
                score: 0.9,
                reasons: ['Excellent structured output', 'Strong reasoning capabilities']
            });
        }

        // Gemini recommendations
        if (contextSize > 50000 || task === 'large_codebase_analysis') {
            recommendations.push({
                provider: 'gemini',
                score: 0.95,
                reasons: ['Large context window', 'Good for comprehensive analysis']
            });
        }

        // Ollama recommendations
        if (requirements.privacy || requirements.offline) {
            recommendations.push({
                provider: 'ollama',
                score: 0.8,
                reasons: ['Privacy focused', 'Offline capable', 'No rate limits']
            });
        }

        return recommendations.sort((a, b) => b.score - a.score);
    }

    /**
     * Clear caches
     */
    clearCache() {
        this.contextCache.clear();
    }

    /**
     * Get optimization metrics
     */
    getMetrics() {
        return {
            cacheSize: this.contextCache.size(),
            providerLimits: this.providerLimits,
            strategiesCount: this.optimizationStrategies.size
        };
    }
}

// Export singleton instance
export const providerOptimizer = new ProviderOptimizer();