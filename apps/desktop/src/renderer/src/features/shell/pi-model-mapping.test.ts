import { describe, expect, test } from "vitest";
import {
  PI_MODEL_ERROR,
  PI_MODEL_EXAMPLE,
  PI_MODEL_HELPER,
  resolvePiModelField,
} from "./pi-model-mapping";

describe("resolvePiModelField", () => {
  test("the issue's literal flags string reaches provider+model", () => {
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: "--provider dgx-spark --model qwen3.8-flash-next-nvidia-nvfp4",
        provider: "",
      }),
    ).toEqual({
      provider: "dgx-spark",
      model: "qwen3.8-flash-next-nvidia-nvfp4",
    });
  });

  test("flags parse in either order, with = and quotes", () => {
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: "--model qwen3.8-flash --provider dgx-spark",
        provider: "",
      }),
    ).toEqual({ provider: "dgx-spark", model: "qwen3.8-flash" });
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: '--provider=dgx-spark --model="qwen3.8-flash"',
        provider: "",
      }),
    ).toEqual({ provider: "dgx-spark", model: "qwen3.8-flash" });
  });

  test("the fork's provider/model-id form passes through as the model", () => {
    // `pi --model` accepts "provider/id" with no --provider needed.
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
        provider: "",
      }),
    ).toEqual({ model: "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4" });
  });

  test("bare ids and thinking suffixes pass through; blank means default", () => {
    expect(
      resolvePiModelField({ harnessId: "pi", model: "sonnet:high", provider: "" }),
    ).toEqual({ model: "sonnet:high" });
    expect(
      resolvePiModelField({ harnessId: "pi", model: "  ", provider: "" }),
    ).toEqual({});
    expect(
      resolvePiModelField({ harnessId: "pi", model: "", provider: "dgx-spark" }),
    ).toEqual({ provider: "dgx-spark" });
  });

  test("matching explicit provider agrees with flags; conflicts error", () => {
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: "--provider dgx-spark --model qwen",
        provider: "dgx-spark",
      }),
    ).toEqual({ provider: "dgx-spark", model: "qwen" });
    const conflict = resolvePiModelField({
      harnessId: "pi",
      model: "--provider a --model qwen",
      provider: "b",
    });
    expect("error" in conflict && conflict.error).toMatch(/disagrees/);
  });

  test("invalid pi models fail with the fork's error, never a silent drop", () => {
    for (const model of ["--bogus x", "--model", "semi;colon"]) {
      const resolved = resolvePiModelField({
        harnessId: "pi",
        model,
        provider: "",
      });
      expect("error" in resolved, model).toBe(true);
    }
    expect(
      resolvePiModelField({ harnessId: "pi", model: "-x", provider: "" }),
    ).toEqual({ error: "Invalid model" });
    expect(
      resolvePiModelField({ harnessId: "pi", model: "has spaces", provider: "" }),
    ).toEqual({ error: PI_MODEL_ERROR });
  });

  test("helper copy is the fork's sentence with the documented example", () => {
    expect(PI_MODEL_EXAMPLE).toBe(
      "dgx-spark/qwen3.8-flash-next-nvidia-nvfp4",
    );
    expect(PI_MODEL_HELPER).toContain(
      "Use an exact Pi provider/model ID",
    );
    expect(PI_MODEL_HELPER).toContain(PI_MODEL_EXAMPLE);
    expect(PI_MODEL_HELPER).toContain("Blank uses Pi settings.");
    // The example itself parses as the fork's provider/model shape.
    expect(
      resolvePiModelField({
        harnessId: "pi",
        model: PI_MODEL_EXAMPLE,
        provider: "",
      }),
    ).toEqual({ model: PI_MODEL_EXAMPLE });
  });

  test("non-pi harnesses take a bare model id; flags are an error", () => {
    expect(
      resolvePiModelField({ harnessId: "claude", model: "opus", provider: "" }),
    ).toEqual({ model: "opus" });
    expect(
      resolvePiModelField({ harnessId: "claude", model: "", provider: "x" }),
    ).toEqual({});
    const flags = resolvePiModelField({
      harnessId: "claude",
      model: "--model opus",
      provider: "",
    });
    expect("error" in flags && flags.error).toMatch(/only for Pi/);
  });
});
