import { expect, test } from "@playwright/test";

const MOCK_WLLAMA_MODULE = String.raw`
export class CacheManager {
  constructor(backends = []) {
    this.backends = backends;
  }
}

export class Wllama {
  constructor(wasmPaths, options) {
    this.loaded = false;
    globalThis.__wllamaTest = {
      activeGenerations: 0,
      maxActiveGenerations: 0,
      chatCalls: [],
      exitCalls: 0,
      loadCall: null,
      wasmPaths,
      hasCacheManager: Boolean(options?.cacheManager),
    };
  }

  isModelLoaded() {
    return this.loaded;
  }

  async loadModel(files, options) {
    this.loaded = true;
    globalThis.__wllamaTest.loadCall = {
      fileNames: files.map((file) => file.name),
      options,
    };
  }

  async createChatCompletion(options) {
    const state = globalThis.__wllamaTest;
    const systemPrompt = options.messages[0]?.content ?? "";
    const kind = systemPrompt.includes("spelling and typing-error checker")
      ? "correction"
      : "suggestion";
    state.chatCalls.push({
      kind,
      maxTokens: options.max_tokens,
      temperature: options.temperature,
      messages: options.messages,
    });
    state.activeGenerations += 1;
    state.maxActiveGenerations = Math.max(
      state.maxActiveGenerations,
      state.activeGenerations,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
    state.activeGenerations -= 1;

    return {
      choices: [
        {
          message: {
            content:
              kind === "correction" ? "quickly." : " useful continuation.",
          },
        },
      ],
    };
  }

  async exit() {
    this.loaded = false;
    globalThis.__wllamaTest.exitCalls += 1;
  }
}
`;

test("AI writing settings expose and persist both writing tools", async ({
  page,
}) => {
  await page.goto("/new");

  const settingsButton = page.getByRole("button", {
    name: "AI writing settings",
  });
  await expect(settingsButton).toBeVisible();
  await settingsButton.hover();
  await expect(page.getByRole("tooltip")).toHaveText("AI writing settings");
  await settingsButton.click();

  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Local AI writing" });
  await expect(dialog.getByRole("heading", { name: "Local AI writing" })).toBeVisible();

  const suggestions = dialog.getByRole("switch", {
    name: "Enable text suggestions",
  });
  const autocorrection = dialog.getByRole("switch", {
    name: "Enable AI autocorrection",
  });
  await expect(suggestions).not.toBeChecked();
  await expect(autocorrection).not.toBeChecked();

  await suggestions.click();
  await autocorrection.click();
  await expect(suggestions).toBeChecked();
  await expect(autocorrection).toBeChecked();
  await expect(
    dialog.getByText("typo checks are queued first", { exact: false }),
  ).toBeVisible();

  await expect(dialog.getByRole("link", { name: "Download GGUF" })).toHaveCount(
    3,
  );
  await expect(
    dialog.getByRole("link", { name: "Model details" }),
  ).toHaveCount(3);
  await expect(
    dialog.getByRole("link", { name: "Download GGUF" }).nth(1),
  ).toHaveAttribute(
    "href",
    /Qwen2\.5-0\.5B-Instruct-GGUF.*qwen2\.5-0\.5b-instruct-q4_k_m\.gguf/,
  );

  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();
  await settingsButton.click();
  await expect(suggestions).toBeChecked();
  await expect(autocorrection).toBeChecked();
});

test("disabling both tools keeps the loaded GGUF ready for re-enabling", async ({
  page,
}) => {
  await page.route("**/@wllama_wllama_esm_index__js.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: MOCK_WLLAMA_MODULE,
    });
  });
  await page.goto("/new");

  await page.getByRole("button", { name: "AI writing settings" }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ hasText: "Local AI writing" });
  await dialog.locator('input[type="file"]').setInputFiles({
    name: "session-model.gguf",
    mimeType: "application/octet-stream",
    buffer: Buffer.from("fake GGUF"),
  });
  await expect(dialog.getByText("session-model.gguf", { exact: true })).toBeVisible();

  const suggestions = dialog.getByRole("switch", {
    name: "Enable text suggestions",
  });
  const autocorrection = dialog.getByRole("switch", {
    name: "Enable AI autocorrection",
  });
  await expect(suggestions).toBeChecked();
  await autocorrection.click();
  await expect(autocorrection).toBeChecked();
  await suggestions.click();
  await autocorrection.click();
  await expect(suggestions).not.toBeChecked();
  await expect(autocorrection).not.toBeChecked();

  // Re-enable without refreshing or selecting the file again. The switches
  // pause inference; they must not release the session-only File/model.
  await suggestions.click();
  await expect(suggestions).toBeChecked();

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/textSuggest/wllamaService.ts";
    const { textSuggestService } = await import(modulePath);
    const modelId = Reflect.get(textSuggestService, "loadedModelId") as string;
    const suggestion = await textSuggestService.suggest(
      { prefix: "The model is still" },
      { maxTokens: 16, temperature: 0.35 },
    );
    const mockState = Reflect.get(globalThis, "__wllamaTest");
    const loaded = textSuggestService.isModelLoaded(modelId);
    const exitCallsBeforeCleanup = mockState.exitCalls;
    await textSuggestService.unload();
    return { loaded, suggestion, exitCallsBeforeCleanup };
  });

  expect(result.loaded).toBe(true);
  expect(result.suggestion.text).toBe(" useful continuation");
  expect(result.exitCallsBeforeCleanup).toBe(0);
});

test("Wllama adapter loads GGUF and serializes correction with autocomplete", async ({
  page,
}) => {
  await page.route("**/@wllama_wllama_esm_index__js.js*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: MOCK_WLLAMA_MODULE,
    });
  });
  await page.goto("/new");

  const result = await page.evaluate(async () => {
    const modulePath = "/src/lib/textSuggest/wllamaService.ts";
    const { textSuggestService } = await import(modulePath);
    const progress: number[] = [];
    const model = {
      id: "custom:e2e-wllama",
      label: "mock.gguf",
    };

    await textSuggestService.ensureLoadedFromFile(
      new File(["fake GGUF"], "mock.gguf"),
      model,
      ({ bytes }: { bytes: number }) => progress.push(bytes),
    );

    const [correction, suggestion] = await Promise.all([
      textSuggestService.correctWord({
        word: "quiglyy",
        context: "Please finish this quiglyy ",
      }),
      textSuggestService.suggest(
        { prefix: "This is a" },
        { maxTokens: 24, temperature: 0.35 },
      ),
    ]);

    const loadedBeforeUnload = textSuggestService.isModelLoaded(model.id);
    const mockState = Reflect.get(globalThis, "__wllamaTest");
    await textSuggestService.unload();

    return {
      correction,
      suggestion,
      progress,
      loadedBeforeUnload,
      loadedAfterUnload: textSuggestService.isModelLoaded(model.id),
      mockState,
    };
  });

  expect(result.progress).toEqual([10, 30, 100]);
  expect(result.loadedBeforeUnload).toBe(true);
  expect(result.loadedAfterUnload).toBe(false);
  expect(result.correction.replacement).toBe("quickly");
  expect(result.suggestion.text).toBe(" useful continuation");
  expect(result.mockState.hasCacheManager).toBe(true);
  expect(result.mockState.loadCall.fileNames).toEqual(["mock.gguf"]);
  expect(result.mockState.loadCall.options).toMatchObject({
    n_ctx: 2048,
    jinja: true,
  });
  expect(result.mockState.chatCalls.map((call: { kind: string }) => call.kind)).toEqual([
    "correction",
    "suggestion",
  ]);
  expect(result.mockState.maxActiveGenerations).toBe(1);
  expect(result.mockState.exitCalls).toBe(1);
});
