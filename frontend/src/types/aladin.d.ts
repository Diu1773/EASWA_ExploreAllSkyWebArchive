declare module 'aladin-lite' {
  const A: {
    init: Promise<void>;
    aladin: (...args: any[]) => any;
    catalog: (...args: any[]) => any;
    source: (...args: any[]) => any;
  };

  export default A;
}
