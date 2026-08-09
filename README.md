# Oi Web — عرض Open Interest (مشترك)

نسخة **ويب عرض فقط** لمشروع Oi:

- تحديث صباحي تلقائي من OCC عبر **GitHub Actions** → ملفات JSON
- استضافة مجانية على **GitHub Pages** (أو Cloudflare Pages)
- واجهة: جدول تراكمي · زر Δ · تصدير CSV/Excel · ليلي/نهاري · 5 مؤشرات
- **جهازك ليس سيرفرًا**
- **بيانات عرض مشتركة** (نفس اللقطة لكل الزوار)

## البنية

```
oi-web/
  scripts/fetch_occ.py          # سحب OCC + دمج تاريخي → data/*.json
  .github/workflows/update-data.yml
  data/                         # SPY.json … index.json (+ *_history.json داخلي)
  web/                          # الواجهة الثابتة
    index.html
    app.js
    styles.css
```

## الخطوات على GitHub

1. أنشئي مستودعًا جديدًا (مثال: `oi-web`) وارفعي محتويات هذا المجلد.
2. **Settings → Actions → General**: اسمحي بـ workflow permissions للكتابة (Read and write).
3. **Actions** → شغّلي يدويًا `Update OCC Data` مرة أولى (`workflow_dispatch`).
4. **Settings → Pages**:
   - Source: Deploy from branch
   - Branch: `main` (أو `master`)
   - Folder: `/web` إن دعمها GitHub، أو انقلي محتويات `web/` لجذر المستودع واضبطي المسارات.

### ملاحظة مسار البيانات

في `web/index.html`:

```html
<body data-data-base="../data">
```

- إذا كان الموقع من مجلد `/web` والبيانات في `/data` → `../data` صحيح.
- إذا نشرت `web/*` في جذر Pages وانسختي `data/` بجانبها → استخدمي `data`.

## تشغيل محلي

```bash
cd oi-web
pip install requests yfinance
python scripts/fetch_occ.py

# خادم بسيط
cd web
python -m http.server 8080
# افتحي http://localhost:8080
# إن احتجتِ data من جذر المشروع، عدّلي data-data-base أو انسخي data داخل web/data
```

## ماذا يفعل الـ Action؟

- كل صباح أيام التداول (cron UTC 06:00 ≈ 09:00 السعودية) أو يدويًا
- يسحب OCC للخمس مؤشرات
- يدمج اليوم تحت عمود الجلسة (`d-m`) بدون مسح الأيام السابقة
- يكتب `data/SPY.json` … ويحفظ تاريخًا تراكميًا في `*_history.json`
- يدفع التغييرات للمستودع → Pages يعرض اللقطة الجديدة

## حدود النسخة المجانية

- بيانات **عرض مشتركة** (ليست قاعدة مستقلة لكل مستخدم)
- التصدير من المتصفح = CSV يفتح في Excel (دقيق حسب Days/Strikes الظاهرين)
- OCC قد يغيّر شكل الصفحة؛ راقبي الـ Action logs
- GitHub Actions للمشاريع العامة مجاني ضمن حدود الاستخدام المعقولة

## جملة التذكير

> نفّذ نسخة ويب عرض فقط لمشروع Oi: تحديث صباحي تلقائي من OCC عبر GitHub Actions إلى JSON، استضافة مجانية على GitHub Pages أو Cloudflare Pages، واجهة فيها الجدول التراكمي + زر Δ + تصدير Excel دقيق + ليلي/نهاري للخمس مؤشرات، بدون أن يكون جهازي سيرفر وبدون بيانات مستقلة لكل مستخدم.
