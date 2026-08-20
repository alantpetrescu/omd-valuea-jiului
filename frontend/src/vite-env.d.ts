/// <reference types="vite/client" />

// Vite's ambient types for `import.meta.env`, which `App.tsx` reads to get the
// base path the app was built for. Without this reference `tsc` does not know
// `import.meta` has an `env` property and the build fails — `vite build` alone
// would not have noticed, because it strips types rather than checking them.
