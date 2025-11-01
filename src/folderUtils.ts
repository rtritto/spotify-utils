import fs from 'node:fs'
import path from 'node:path'

const { INPUT_FOLDER = './input', OUTPUT_FOLDER = './output' } = process.env

export const createFolder = (folderPath: string): void => {
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true })
  }
}

export const getInputPath = (file: string): string => {
  return path.join(INPUT_FOLDER, file)
}

export const getOutputPath = (file: string): string => {
  return path.join(OUTPUT_FOLDER, file)
}
