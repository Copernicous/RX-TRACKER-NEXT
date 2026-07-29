const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const db = require('../models');

function text(value) { return String(value || ''); }
exports.download = async (req, res) => {
  try {
    const records = await db.RXRecord.findAll({ include: [db.Patient, db.Pharmacy], order: [['id', 'DESC']], limit: 500 });
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const page = pdf.addPage([612, 792]);
    const { width, height } = page.getSize();
    page.drawText('RB & DC SOLUTIONS LLC - ORIGINAL RECEIPTS DELIVERY LOG', { x: 36, y: height - 42, size: 12, font: bold, color: rgb(.07,.23,.44) });
    page.drawText('Print & Delivery Log', { x: 36, y: height - 68, size: 20, font: bold, color: rgb(.07,.23,.44) });
    page.drawText('Interactive PDF - complete fields before saving or printing', { x: 36, y: height - 88, size: 8, font });
    let y = height - 125;
    const headers = ['Date Delivered', 'Patient Full Name', 'DOB', 'Driver', 'Notes'];
    const xs = [36, 110, 300, 370, 455];
    headers.forEach((h, i) => { page.drawText(h, { x: xs[i], y, size: 8, font: bold, color: rgb(1,1,1) }); page.drawRectangle({ x: xs[i]-3, y:y-4, width: [74,190,70,85,120][i], height: 18, color: rgb(.07,.23,.44) }); page.drawText(h, { x: xs[i], y, size: 8, font: bold, color: rgb(1,1,1) }); });
    y -= 24;
    records.slice(0, 18).forEach((rx, index) => { const rowY = y - index * 28; const values = ['', text(rx.Patient && ((rx.Patient.firstName || '') + ' ' + (rx.Patient.lastName || '')).trim()), text(rx.Patient && rx.Patient.dob), '', '']; const widths=[74,190,70,85,120]; values.forEach((v,i)=>{ page.drawRectangle({x:xs[i]-3,y:rowY-8,width:widths[i],height:22,borderColor:rgb(.75,.8,.86),borderWidth:1}); if(i===3||i===4){ const field=pdf.getForm().createTextField('driver_notes_'+index+'_'+i); field.addToPage(page,{x:xs[i],y:rowY-5,width:widths[i]-6,height:16,borderWidth:0,textColor:rgb(.08,.14,.24),font}); } else page.drawText(v.slice(0,28),{x:xs[i],y:rowY,size:8,font}); }); });
    const form = pdf.getForm(); let sy = 120; page.drawText('Receipt Acknowledgment', { x: 36, y: sy+55, size: 12, font: bold, color: rgb(.07,.23,.44) }); ['Received By (Print Name)','Recipient Signature','Date / Time Received','Pharmacy Representative Signature','Exception Reference / Notes'].forEach((label,i)=>{const x=36+(i%3)*190;const yy=sy-(Math.floor(i/3)*38);page.drawText(label,{x,y:yy+18,size:8,font});const f=form.createTextField('ack_'+i);f.addToPage(page,{x,y:yy-2,width:160,height:16,borderWidth:1});});
    const bytes = await pdf.save(); res.set({ 'Content-Type':'application/pdf', 'Content-Disposition':'attachment; filename="rx-delivery-log-interactive.pdf"' }); res.send(Buffer.from(bytes));
  } catch (err) { res.status(500).json({ error: err.message }); }
};
