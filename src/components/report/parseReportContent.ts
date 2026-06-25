// ─── Component ────────────────────────────────────────────────────────────────
// ─── Parse dual-output: split MD and HTML blocks ─────────────────────────────
export function parseReportContent(raw: string): { md: string; htmlBody: string } {
  const mdMatch = raw.match(/%%MD_START%%([\s\S]*?)%%MD_END%%/);
  const htmlMatch = raw.match(/%%HTML_BODY_START%%([\s\S]*?)%%HTML_BODY_END%%/);
  return {
    md: mdMatch ? mdMatch[1].trim() : raw,
    htmlBody: htmlMatch ? htmlMatch[1].trim() : '',
  };
}
