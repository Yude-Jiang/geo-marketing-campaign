import { GoogleGenAI, Type } from "@google/genai";
import * as dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });

const ai = new GoogleGenAI({ apiKey: process.env.VITE_GEMINI_API_KEY });

async function test() {
  console.log("Testing search grounding with ONLY JSON schema...");
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-pro",
      contents: "Tell me the current price of Bitcoin today and output as JSON.",
      config: {
        tools: [{ googleSearch: {} }],
        responseSchema: {
          type: Type.OBJECT,
          properties: { price: { type: Type.STRING } },
        },
      },
    });
    console.log("Success:", response.text);
  } catch (e: any) {
    console.error("Error:", e.message);
  }
}

test();
