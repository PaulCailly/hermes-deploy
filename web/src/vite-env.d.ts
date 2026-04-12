/// <reference types="vite/client" />

declare module '*.css' {
  const content: string;
  export default content;
}

declare module 'xterm/css/xterm.css' {
  const content: string;
  export default content;
}
