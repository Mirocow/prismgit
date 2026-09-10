export interface FsApi {
  openDirectoryPicker: () => Promise<string | null>;
  openRepositoryPicker: () => Promise<string | null>;
  showSaveDialog: (opts: Electron.SaveDialogOptions) => Promise<string | null>;
  readFile: (filePath: string) => Promise<string>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  pathBasename: (filePath: string) => Promise<string>;
  pathDirname: (filePath: string) => Promise<string>;
  openTerminal: (dirPath: string) => Promise<boolean>;
}
