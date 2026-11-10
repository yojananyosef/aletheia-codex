import { describe, expect, it } from "vitest";
import { cleanAiText } from "../src/lib/ai/format";

describe("cleanAiText", () => {
  it("normalises line endings and strips Markdown decoration", () => {
    expect(
      cleanAiText("## Título\r\n\r\n**uno**\r\n- dos\r\n`tres`\r\n\r\n\r\nfin"),
    ).toBe("Título\n\nuno\n• dos\ntres\n\nfin");
  });

  it("keeps only the final channel when a thinking channel is present", () => {
    expect(
      cleanAiText(
        "<|channel>thought\nrazonamiento interno<|channel|>Respuesta final<|end|>",
      ),
    ).toBe("Respuesta final");
  });

  it("removes control characters and trims surrounding whitespace", () => {
    expect(cleanAiText("\u0000  hola  \n")).toBe("hola");
  });

  it("returns an empty string when there is no usable answer", () => {
    expect(cleanAiText("   \n\n  ")).toBe("");
  });
});
