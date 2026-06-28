# Vendored whisper.cpp WASM

The dictation feature loads `whisper.mjs` + `whisper.wasm` from this directory at runtime. These files are intentionally **not** in the npm dependency graph — vendor them by building whisper.cpp once and committing the artifacts.

## Build

Requires [Emscripten SDK](https://emscripten.org/docs/getting_started/downloads.html) (`emsdk activate latest && source ./emsdk_env.sh`).

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
emcmake cmake -B build-em \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_EXAMPLES=ON \
  -DCMAKE_EXE_LINKER_FLAGS="-s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME=createWhisperModule -s ALLOW_MEMORY_GROWTH=1 -s INITIAL_MEMORY=512MB"
cmake --build build-em -j --target whisper
```

Then copy the produced `whisper.js`/`whisper.wasm` (rename `.js` → `.mjs` if needed) into this directory:

```bash
cp build-em/bin/whisper.js  /path/to/nostr-docs/public/whisper/whisper.mjs
cp build-em/bin/whisper.wasm /path/to/nostr-docs/public/whisper/whisper.wasm
```

## Why vendor?

- No reliably maintained npm wrapper for whisper.cpp WASM at the time of writing.
- Lets us pin a known-good build per app release.
- `~1–2 MB` of glue + `~few hundred KB` WASM, served from the app's own origin.

## Runtime contract

The Emscripten build is expected to register a default-exported factory (`createWhisperModule`) that resolves to a `Module` with at least:

- `FS_createDataFile(parent, name, data, canRead, canWrite, canOwn)` — write model bytes into the in-memory FS.
- `init(modelPath: string): number` — load the GGML model, return an instance id.
- `full_default(instance, audio: Float32Array, lang: string, nthreads: number, translate: boolean): number` — run inference. Returns `0` on success.
- `free(instance: number)` — release.
- `print(s)` / `printErr(s)` — stdout/stderr hooks; transcript lines arrive via `print`.

If the upstream sample names differ in your build (e.g. `set_status` instead of `print`), adapt `src/lib/dictation/wasmBackend.ts`.
