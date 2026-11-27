exports.handler = async (event) => (await import('./geoscan.mjs')).handler(event);
