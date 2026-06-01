declare module 'node-pty' {
  export interface IPty {
    pid: number;
    cols: number;
    rows: number;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
    onData(listener: (data: string) => void): void;
    onExit(listener: (e: { exitCode: number; signal?: number }) => void): void;
  }

  export interface IWindowsPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    encoding?: string | null;
    useConpty?: boolean;
  }

  export interface IPtyForkOptions extends IWindowsPtyForkOptions {
    uid?: number;
    gid?: number;
    binary?: string;
  }

  function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;

  const pty: { spawn: typeof spawn };
  export default pty;
}
