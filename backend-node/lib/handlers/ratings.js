// ============== SATISFACTION RATINGS & FEEDBACK HANDLERS ==============

const { SHEETS, setDoc, listDocs } = require('../firestore');
const { newId, nowStr, logAudit } = require('../util');

/**
 * บันทึกผลการประเมินความพึงพอใจ
 */
async function saveSatisfactionRating(ratingData, userName) {
  try {
    const ratingScore = parseInt(ratingData.rating || ratingData.stars || 5, 10);
    if (isNaN(ratingScore) || ratingScore < 1 || ratingScore > 5) {
      return { success: false, message: 'คะแนนการประเมินต้องอยู่ระหว่าง 1 ถึง 5 ดาว' };
    }

    const docId = newId('RAT');
    const newRating = {
      id: docId,
      category: String(ratingData.category || 'system').trim(),
      refId: String(ratingData.refId || '-').trim(),
      rating: ratingScore,
      comment: String(ratingData.comment || '').trim(),
      userName: String(userName || ratingData.userName || 'ผู้ใช้งานระบบ').trim(),
      dept: String(ratingData.dept || '-').trim(),
      createdAt: nowStr(),
    };

    await setDoc(SHEETS.SATISFACTION_RATINGS, docId, newRating);
    await logAudit('ประเมินความพึงพอใจ', newRating.userName, `${newRating.rating} ดาว, หมวด: ${newRating.category}`);

    return { success: true, message: 'บันทึกการประเมินความพึงพอใจเรียบร้อยแล้ว ขอบคุณสำหรับข้อเสนอแนะ!', docId };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

/**
 * ดึงสรุปสถิติและรายการประเมินความพึงพอใจทั้งหมด
 */
async function getSatisfactionRatings() {
  try {
    const rows = await listDocs(SHEETS.SATISFACTION_RATINGS);
    rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

    const total = rows.length;
    let sumScore = 0;
    const distribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    const categories = {};

    rows.forEach((r) => {
      const score = parseInt(r.rating || 5, 10);
      sumScore += score;
      if (distribution[score] !== undefined) distribution[score]++;
      const cat = r.category || 'system';
      categories[cat] = (categories[cat] || 0) + 1;
    });

    const average = total > 0 ? (sumScore / total).toFixed(2) : '5.00';

    return {
      success: true,
      stats: {
        total,
        average,
        distribution,
        categories,
      },
      data: rows,
    };
  } catch (err) {
    return { success: false, message: err.message };
  }
}

module.exports = {
  saveSatisfactionRating,
  getSatisfactionRatings,
};
