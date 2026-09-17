import type { LoggerMessage, Worker } from 'tesseract.js'

let workerPromise: Promise<Worker> | null = null
let progressListener: ((progress: number, status: string) => void) | undefined

function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng', 1, {
      workerPath: '/tesseract/worker.min.js',
      corePath: '/tesseract/core',
      langPath: '/tesseract/lang',
      gzip: true,
      logger: (message: LoggerMessage) => {
        progressListener?.(message.progress ?? 0, message.status ?? 'working')
      },
    })).catch(error => {
      workerPromise = null
      throw error
    })
  }
  return workerPromise
}

/** Runs entirely in the browser. The image is never uploaded to an OCR API. */
export async function recognizeImageLocally(file: File, onProgress?: (progress: number, status: string) => void) {
  progressListener = onProgress
  try {
    const worker = await getWorker()
    const result = await worker.recognize(file)
    return result.data.text.trim()
  } finally {
    progressListener = undefined
  }
}
