import { GoogleGenAI } from "@google/genai";
import { config } from "dotenv";

config({ path: ".env.local" });

const apiKey = process.env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY;

if (!apiKey || apiKey === 'PLACEHOLDER_API_KEY') {
  console.log('Error: Invalid API Key loaded:', apiKey);
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey });

async function run() {
  try {
    console.log('Testing generateContent with gemini-2.5-pro...');
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    console.log('Success (2.5-pro):', response.text);

    console.log('Testing generateContent with gemini-3-pro-preview...');
    const response2 = await ai.models.generateContent({
      model: "gemini-3-pro-preview",
      contents: [{ role: "user", parts: [{ text: "Hello" }] }],
    });
    console.log('Success (3-pro-preview):', response2.text);
    
  } catch(e) {
    console.error('API OVERALL ERROR:', e.message);
  }
}

run();
