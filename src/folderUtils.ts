import fs from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

const { INPUT_FOLDER = './input', OUTPUT_FOLDER = './output' } = process.env

// Get current date as YYYYMMDD string
export const getCurrentDateString = (complete = false): string => {
  const currentDate = new Date()
  return [
    currentDate.getFullYear(),  // YYYY
    (currentDate.getMonth() + 1).toString().padStart(2, '0'),  // MM
    currentDate.getDate().toString().padStart(2, '0'),  // DD
    ...(complete ? [
      'T',
      currentDate.getHours().toString().padStart(2, '0'),  // hh
      currentDate.getMinutes().toString().padStart(2, '0'),  // mm
      currentDate.getSeconds().toString().padStart(2, '0')   // ss
    ] : [])
  ].join('')
}

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

// Compress multiple files from a folder as source into a zip file
// eg: compressFolderToZip('./output/20240330') creates './output/20240330.zip'
export const compressFolderToZip = (sourceFolder: string): void => {
  const zip = new AdmZip()
  const files = fs.readdirSync(sourceFolder)
  for (const file of files) {
    const filePath = path.join(sourceFolder, file)
    zip.addLocalFile(filePath)
  }
  zip.writeZip(path.join(sourceFolder, `${path.basename(sourceFolder)}.zip`))
}
