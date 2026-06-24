// Supplemental types for groundingMetadata, which the @google/genai SDK does
// not currently export on its response object. Used to replace ad-hoc
// `(result as any).groundingMetadata` casts with a typed narrowing.

export interface GroundingChunk {
  web?: {
    title?: string;
    uri?: string;
  };
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  webSearchQueries?: string[];
}

export interface GeminiResponseWithGrounding {
  groundingMetadata?: GroundingMetadata;
  text?: string;
}
