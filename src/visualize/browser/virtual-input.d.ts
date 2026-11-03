declare module 'virtual:input' {
  const preview: (context: unknown) => unknown | Promise<unknown>;
  export default preview;
  export const detectors: Record<
    string,
    import('xrblocks').HeuristicGestureDetector
  >;
}
