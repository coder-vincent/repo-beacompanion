// Disables console.log across the client bundle
// Useful for production to avoid leaking debug info
/* eslint-disable no-console, no-global-assign */
console.log = () => {};
