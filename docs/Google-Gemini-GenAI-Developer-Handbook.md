# Google Gemini Generative‑AI Developer Handbook

*July 25, 2025*

This handbook consolidates current (as of 25 July 2025) information about Google’s Gemini API for generative AI and related models. It is intended for engineers building applications with the Gemini platform.
Gemini evolves rapidly; always check Google’s release notes and documentation for updates.

---

## 1. Overview of the Gemini API

### 1.1 What is Gemini?

Gemini is Google’s family of **multimodal generative models**.

* The **Gemini API** is exposed via Google AI Studio (for prototyping) and the Gemini Developer API (for production).
* Supports **text, image, video, audio, and PDF** as input, and can generate text, structured data, images, audio, or video.
* **Key Features:**

  * Large context windows (up to **1 million tokens** in, **65,536 tokens** out)
  * Multimodal support in one prompt
  * Structured output (JSON), function calling, code execution, search grounding, URL reading
  * Built-in context caching (reduces cost for repeated prompts)
  * Safety controls (harassment, hate, sexual, dangerous, civic integrity filtering)

### 1.2 Model Variants

| Model                         | Key Features                                                    | Input/Output                | Availability         |
| ----------------------------- | --------------------------------------------------------------- | --------------------------- | -------------------- |
| Gemini 2.5 Pro                | Premium reasoning, all modalities except image/audio generation | 1M/65k tokens, best quality | Paid (limited free)  |
| Gemini 2.5 Flash              | Balanced latency/cost, supports image/audio generation          | 1M/65k tokens, fast, cheap  | Paid (generous free) |
| Gemini 2.5 Flash Lite         | Cost-efficient, lower performance, high-volume                  | 1M/65k tokens, low price    | Paid (large free)    |
| Gemini 2.5 Flash Native Audio | Live API, streaming audio (no image)                            | Live API                    | Preview              |
| Gemini 1.5 Pro (deprec.)      | Older, long-context, no image gen, deprecated in Sept 2025      | Up to 2M tokens             | Use 2.5 models       |
| Others                        | Imagen (image), Veo (video), Lyria (music), TTS, Embeddings     | Varies                      | See docs             |

---

## 2. Getting Started

### 2.1 Set Up a Project & API Key

1. **Sign up at Google AI Studio** → create project → generate API key
2. **Install SDK:**

```bash
# Node.js
npm install @google/genai

# Python
pip install google-generative-ai
```

3. **Authenticate:**

   * Set `GEMINI_API_KEY` in your environment or pass it directly in code.

### 2.2 Hello World Example

**JavaScript (Node.js):**

```js
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function helloWorld() {
  const result = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Explain how AI works',
  });
  console.log(result.text);
}

helloWorld().catch(console.error);
```

**Python:**

```python
from google import genai
client = genai.Client()
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="Explain how AI works",
)
print(response.text)
```

#### Streaming Response (Node.js)

```js
async function chatStream() {
  const stream = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: 'Write a short poem about the sea.',
    stream: true,
    generationConfig: {
      temperature: 0.7,
      topK: 40,
      topP: 0.9,
      maxOutputTokens: 200,
    },
  });
  for await (const chunk of stream.stream) {
    process.stdout.write(chunk.text || '');
  }
}
chatStream().catch(console.error);
```

### 2.3 Using OpenAI Libraries

**Python (OpenAI client):**

```python
from openai import OpenAI
client = OpenAI(
    api_key="GEMINI_API_KEY",
    base_url="https://generativelanguage.googleapis.com/v1beta/openai/"
)
response = client.chat.completions.create(
    model="gemini-2.5-flash",
    messages=[{"role": "user", "content": "Explain how AI works"}]
)
print(response.choices[0].message)
```

**Node.js (OpenAI SDK):**

```js
import OpenAI from 'openai';
const openai = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});

async function chat() {
  const response = await openai.chat.completions.create({
    model: 'gemini-2.5-flash',
    messages: [{ role: 'user', content: 'Explain how AI works' }],
  });
  console.log(response.choices[0].message);
}
chat().catch(console.error);
```

---

## 3. Generation Basics

### 3.1 Text Generation Parameters

* `temperature`: 0–2 (higher = more random)
* `topP`: 0–1 (probability mass to sample)
* `topK`: integer (top K tokens)
* `maxOutputTokens`: max length
* `stream`: `true` for streaming responses

### 3.2 Multimodal Prompts

Combine text, image, video, audio, and PDF in one prompt. Use base64 or Files API for media.

### 3.3 Structured Outputs (JSON)

**JavaScript Example:**

```js
const schema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    author: { type: 'string' },
    year: { type: 'number' },
  },
  required: ['title', 'author', 'year'],
};
const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: `Provide the book metadata for "Pride and Prejudice"`,
  responseSchema: schema,
  responseMimeType: 'application/json',
});
console.log(JSON.parse(res.text));
```

### 3.4 Customize Generation (JS Example)

```js
async function summarizeArticle(url) {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: `Summarize the main points from the following article: ${url}`,
    generationConfig: {
      temperature: 0.2,
      topK: 20,
      topP: 0.8,
      maxOutputTokens: 512,
    },
  });
  console.log(res.text);
}
```

---

## 4. Tooling and Agents

### 4.1 Function Calling

**Declare tools and process function calls:**

```js
const tools = [
  {
    name: "get_weather",
    description: "Get current weather for a city.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "The city" },
      },
      required: ["location"],
    },
  },
];

async function run() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    tools,
    contents: 'What is the weather in Singapore today?',
  });
  const message = response.candidates?.[0];
  if (message && message.functionCall) {
    const { name, args } = message.functionCall;
    // Simulate API call
    const data = await getWeather(args.location);
    const followUp = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      tools,
      contents: [
        response.candidates[0],
        { toolResponse: { name, response: JSON.stringify(data) } },
      ],
    });
    console.log(followUp.text);
  } else {
    console.log(response.text);
  }
}
```

### 4.2 Thinking/Reasoning Control

* Use `thinkingBudget` (fine control) or `reasoning_effort` (OpenAI SDK, levels: low/medium/high).
* Use `include_thoughts` for intermediate reasoning/debugging.

### 4.3 Grounding with Google Search

**Enable real-time web search and citations:**

```js
async function askWithCitations(question) {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    tools: [{ type: 'google_search', maxResults: 3 }],
    contents: question,
  });
  console.log(res.text);
  console.log(res.groundingMetadata?.groundingSupports);
}
```

### 4.4 URL Context Tool

**Summarize a web page:**

```js
async function summarizeURL(url) {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    tools: [{ type: 'url_context', urls: [url] }],
    contents: `Summarize the contents of the article at the provided URL`,
  });
  console.log(res.text);
  console.log(res.urlContextMetadata);
}
```

### 4.5 Code Execution

**Invoke Python code execution from JS:**

```js
async function computeAverage() {
  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    tools: ['code_execution'],
    contents: 'Compute the average of the numbers [2, 4, 6, 10] and output the result.',
  });
  console.log('Generated code:\n', res.executableCode);
  console.log('Result:', res.codeExecutionResult);
}
```

### 4.6 Live API (WebSocket streaming)

* Use `client.live.language.connect()` for live chat or streaming TTS/music.
* See [Google Live API Guide](https://ai.google.dev/docs/live-api) for session management and tools.

---

## 5. Multimodal Understanding

### 5.1 Images, Video, PDF, Audio

**Image analysis:**

```js
import fs from 'fs';
const imageBytes = fs.readFileSync('photo.jpg').toString('base64');
const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [
    { text: 'Describe the following image:' },
    { inlineData: { mimeType: 'image/jpeg', data: imageBytes } },
  ],
});
console.log(res.text);
```

**PDF summarization:**

```js
const pdfBytes = fs.readFileSync('report.pdf').toString('base64');
const res = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [
    { text: 'Summarize this document:' },
    { inlineData: { mimeType: 'application/pdf', data: pdfBytes } },
  ],
});
console.log(res.text);
```

### 5.2 Embeddings for Search & Retrieval

```js
const res = await ai.embeddings.embedContent({
  model: 'gemini-embedding-001',
  content: 'Quantum mechanics is the study...',
  outputDimensionality: 768,
});
console.log('Embedding length:', res.embedding.length);
console.log('First 5 values:', res.embedding.slice(0, 5));
```

---

## 6. Generation: Images, Speech, Music, Video

* **Image generation:** Use `responseModalities: ["TEXT", "IMAGE"]`.
* **Speech (TTS):** Use TTS models (e.g., `gemini-2.5-flash-preview-tts`).
* **Music:** Use Lyria RealTime via streaming session, weighted prompts.
* **Video:** Use Veo 3 for video generation. Poll for completion.

---

## 7. Context & Batch Processing

* **Context caching:** Reuse prompt tokens to save cost.
* **Batch mode:** Submit jobs for offline processing at reduced cost.
* **Files API:** For media/PDF files up to 2GB.

---

## 8. Pricing, Rate Limits, Billing

* **2.5 Pro:** \$1.25–2.50/1M in; \$10–15/1M out; caching extra.
* **2.5 Flash:** \$0.30–1.00/1M in; \$2.50/1M out; caching extra.
* **2.5 Flash Lite:** \$0.10–0.30/1M in; \$0.80/1M out.
* **Rate limits:** Vary by model and tier. Free/paid tiers have different RPM/TPM limits.

---

## 9. Safety & Responsible Use

* **Adjustable safety filters** (harassment, hate, sexual, dangerous, civic).
* **Best practices:** Clear instructions, constraints, few-shot examples, chunking complex tasks, verifying outputs.
* **Manual evaluation** and additional safeguards required.

---

## 10. Additional Tools & Guides

* **OpenAI compatibility:** Use baseURL, set API key; some Gemini features via extra\_body.
* **URL context, grounding, music, audio, video:** See individual sections above.
* **Code execution:** For calculations, analysis, visualization (sandboxed Python).

---

## 11. Limitations & Future

* **Rapid updates:** 1.5 Pro deprecated Sept 2025; use 2.5 models.
* **Regional/compliance:** Some models/tools not in all regions.
* **Latency:** Plan for async when needed.
* **Experimental features:** URL context, music, etc. may change.

---

## 12. Conclusion

The Gemini API is a flexible, powerful platform for building intelligent, multimodal applications.

* Understand the models, parameters, and tools available
* Use best practices for prompting and safety
* Monitor updates and pricing
* Always test thoroughly and add safeguards

**See [Google AI Documentation](https://ai.google.dev) for latest info.**
