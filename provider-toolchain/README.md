# Provider toolchain

This is an independent frozen pnpm workspace for the Paseo CLI/server closure.
The application workspace deliberately does not install `@getpaseo/cli` or
provider platform packages. Native providers are described by
`providers.manifest.json` and are filled into a stamp-keyed external volume by
`scripts/provider-toolchain.mjs` at deploy time.

The manifest carries exact artifact and installed-binary SHA-256 values. Test/file overrides exist only for acceptance mutation harnesses.
