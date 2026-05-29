// automation/shared/upload.js
// Handles file uploads to AHJ portal form fields

async function uploadFile(page, selector, filePath, logStep, runId, stepNumber, stepName) {
    await logStep(page, runId, stepNumber, stepName, async () => {
      const fileInput = page.locator(
        Array.isArray(selector) ? selector.join(', ') : selector
      ).first()
  
      await fileInput.setInputFiles(filePath)
      await page.waitForTimeout(1000)
    })
  }
  
  async function uploadBuffer(page, selector, fileBuffer, fileName, mimeType) {
    const fileInput = page.locator(
      Array.isArray(selector) ? selector.join(', ') : selector
    ).first()
  
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: mimeType,
      buffer: fileBuffer,
    })
  
    await page.waitForTimeout(1000)
  }
  
  module.exports = { uploadFile, uploadBuffer }