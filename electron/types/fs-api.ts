export interface FsApi {
  openDirectoryPicker: () => Promise<string | null>;
  openRepositoryPicker: () => Promise<string | null>;
  showSaveDialog: (opts: Electron.SaveDialogOptions) => Promise<string | null>;
  readFile: (filePath: string) => Promise<string>;
  pathBasename: (filePath: string) => Promise<string>;
  pathDirname: (filePath: string) => Promise<string>;
}
