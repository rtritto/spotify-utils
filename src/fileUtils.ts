import path from 'node:path'

const INPUT_FOLDER = './input'
const OUTPUT_FOLDER = './output'

export const getInputPath = (file: string): string => {
  return path.join(INPUT_FOLDER, file)
}

export const getOutputPath = (file: string): string => {
  return path.join(OUTPUT_FOLDER, file)
}