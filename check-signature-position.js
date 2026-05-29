require('dotenv').config({ path: '.env.local' });
const { PDFDocument } = require('pdf-lib');
const { createClient } = require('@supabase/supabase-js');
(async () => {
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const { data } = await supabase.storage.from('job-documents').download('templates/noc-template.pdf');
  const pdf = await PDFDocument.load(await data.arrayBuffer());
  const form = pdf.getForm();
  const pages = pdf.getPages();
  console.log('Page 2 size:', pages[1].getWidth(), 'x', pages[1].getHeight());
  form.getFields().forEach(f => {
    try {
      const widgets = f.acroField.getWidgets();
      widgets.forEach(w => {
        const rect = w.getRectangle();
        const page = w.P();
        console.log(`"${f.getName()}" x:${Math.round(rect.x)} y:${Math.round(rect.y)} w:${Math.round(rect.width)} h:${Math.round(rect.height)}`);
      });
    } catch(e) {}
  });
})().catch(console.error);
