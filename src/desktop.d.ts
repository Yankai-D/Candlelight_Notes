export {}
declare global {
  interface Window {
    pangzhuDesktop?: {
      chooseLibraryDirectory(current: string): Promise<string | null>
      onCloseRequest(handler: (phase: 'status' | 'save') => Promise<{ busy?: boolean }>): () => void
    }
  }
}
