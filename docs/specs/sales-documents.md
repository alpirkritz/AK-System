# מסמכי מכירה (חשבוניות, הצעות מחיר וקבלות)

> **Slug:** `sales-documents`
> **Status:** Draft
> **Last Updated:** 2026-08-05

## Goal

היום הנפקת מסמכי מכירה נעשית במערכת חיצונית בתשלום, והקבצים נשמרים ידנית בתיקיות ב-Google Drive. בנפח של 1–5 מסמכים בחודש דמי המנוי לא מוצדקים, והנתונים מנותקים מהלקוחות, מהפרויקטים ומדיווח המע״מ שכבר קיימים במערכת. המודול הזה מוסיף ל-`/finance` יכולת להנפיק שישה סוגי מסמכים ישראליים, לשמור אותם מקושרים לחברות ולאנשי קשר, להדפיס אותם כ-PDF במיתוג Alpir Consulting, ולסנכרן אוטומטית את ההכנסה לדיווח המע״מ הקיים. המסמכים תומכים בעברית ובאנגלית, כולל מטבע חוץ ומע״מ בשיעור אפס ליצוא שירותים.

## User Stories

- כעוסק מורשה, אני רוצה להנפיק חשבונית מס מתוך AK במקום ממערכת בתשלום, כדי לחסוך דמי מנוי על כלי שאני משתמש בו מעט.
- כעוסק מורשה, אני רוצה שהמסמך יישא את המיתוג של Alpir Consulting, כדי שייראה מקצועי מול לקוחות.
- כמשתמש, אני רוצה לבחור לקוח מרשימת חברות ולקבל את פרטי החיוב אוטומטית, כדי לא להקליד ח.פ. וכתובת בכל פעם.
- כמשתמש, אני רוצה שכשאני מוסיף שורה מסוג "הרצאה" המערכת תשלוף את המחיר האחרון שחייבתי את הלקוח הזה, וכשאין היסטוריה — את מחיר ברירת המחדל של הפריט.
- כמשתמש, אני רוצה לראות מאיפה הגיע כל מחיר שנמלא אוטומטית, כדי לא להנפיק בטעות מסמך מס עם סכום שגוי.
- כמשתמש, אני רוצה להנפיק חשבונית באנגלית ובדולרים ללקוח בחו״ל, עם מע״מ בשיעור אפס, כדי לתמוך בעבודה בינלאומית.
- כמשתמש, אני רוצה שהנפקת חשבונית מס תיצור אוטומטית רשומת הכנסה בדיווח המע״מ, כדי לא לרשום את אותו נתון פעמיים.
- כמשתמש, אני רוצה להמיר הצעת מחיר לחשבון עסקה ומשם לחשבונית מס, כדי לא להקליד את אותן שורות שוב.
- כמשתמש, אני רוצה שמסמך שהונפק יינעל לעריכה, כדי שלא אשנה בטעות מסמך מס שכבר נשלח.

## Acceptance Criteria

### מספור ונעילה

- [ ] הנפקת מסמך מקצה מספר רץ המשכי לכל סוג מסמך בנפרד, ללא איפוס שנתי.
- [ ] מספר ההתחלה לכל סוג ניתן להגדרה ב-`/settings/business`, כדי להמשיך מהמערכת החיצונית בלי כפילות.
- [ ] שתי הנפקות רצופות של אותו סוג מקבלות מספרים עוקבים ללא דילוג.
- [ ] טיוטה אינה מקבלת מספר; `docNumber` נשאר `null` עד ההנפקה.
- [ ] `updateDraft` על מסמך ב-`status='issued'` נכשל עם `TRPCError` בקוד `CONFLICT`.
- [ ] `remove` מצליח רק על טיוטה; על מסמך שהונפק נכשל ב-`CONFLICT`.
- [ ] `cancel` מותר רק ל-`quote` ו-`proforma`; על מסמך מס נכשל ב-`CONFLICT` עם הודעה שמפנה לחשבונית זיכוי.
- [ ] אחרי הנפקה עדיין ניתן: להוסיף תשלום, להזין מספר הקצאה, ולערוך הערה פנימית.

### חוקי סוגי מסמכים

- [ ] `credit_invoice` בלי `relatedDocumentId` לחשבונית מס שהונפקה נכשל בהנפקה.
- [ ] `tax_invoice_receipt` ו-`receipt` בלי תשלום אחד לפחות נכשלים בהנפקה.
- [ ] `convert` מאפשר רק מעברים ב-`allowedConversions`; מעבר לא חוקי נכשל ב-`BAD_REQUEST`.
- [ ] `createCreditFor` מייצר טיוטת זיכוי עם אותן שורות ואותו לקוח כמו חשבונית המקור.

### חישובים, מע״מ ומטבע

- [ ] `computeDocumentTotals` מחזיר `subtotal`, `vatAmount` ו-`total` מעוגלים לשתי ספרות.
- [ ] ב-`vatMode='zero_rated'` וב-`vatMode='exempt'` מוחזר `vatAmount = 0`.
- [ ] הנחת שורה (`discountPercent`) מופחתת מהשורה לפני חישוב המע״מ.
- [ ] `createDraft` עם `currency !== 'ILS'` וללא `exchangeRate` נכשל ב-`BAD_REQUEST`.
- [ ] `totalIls` מחושב בשרת כ-`total * exchangeRate`, ושווה ל-`total` כשהמטבע `ILS`.
- [ ] הנפקת `tax_invoice` או `tax_invoice_receipt` יוצרת רשומת `vat_entries` עם `entryType='income'`, `taxCode='1'`, `amount = totalIls`, ו-`salesDocumentId` של המסמך.
- [ ] כש-`vatMode !== 'standard'` רשומת המע״מ נוצרת עם `isVatExempt=true`.
- [ ] הנפקה של אותו מסמך פעמיים אינה יוצרת שתי רשומות מע״מ.

### זיכרון תמחור

- [ ] `pricesForClient` מחזיר לכל פריט בקטלוג מחיר ומקור לפי סדר העדיפויות: מחיר קבוע ללקוח, אחריו המחיר האחרון שחויב, אחריו ברירת המחדל של הקטלוג.
- [ ] המחיר ההיסטורי נלקח רק ממסמכים ב-`status='issued'`, ולא מטיוטות ולא מחשבוניות זיכוי.
- [ ] כשקיימות כמה חשבוניות ללקוח, נבחר המחיר מהמסמך עם `issueDate` המאוחר ביותר.
- [ ] כשאין היסטוריה וגם אין מחיר קבוע, המקור המוחזר הוא `catalog`.
- [ ] מחיר היסטורי במטבע שונה ממטבע המסמך מסומן ב-`currencyMismatch=true` ואינו מומר אוטומטית.
- [ ] ארכוב פריט (`archive`) לא משנה שורות במסמכים קיימים.
- [ ] מחיקת פריט מהקטלוג מותירה `serviceItemId=null` בשורות היסטוריות בלי לשבור אותן.

### דו-לשוניות והדפסה

- [ ] `DOCUMENT_STRINGS` מכיל את אותו סט מפתחות ב-`he` וב-`en`.
- [ ] דף ההדפסה מקבל `dir="rtl"` כש-`language='he'` ו-`dir="ltr"` כש-`language='en'`.
- [ ] `document.title` בדף ההדפסה נגזר מ-`buildDocumentFileName`, בעברית או באנגלית לפי שפת המסמך.
- [ ] כשהמטבע אינו `ILS`, המסמך המודפס מציג שורת שווה־ערך בשקלים עם שער ההמרה.
- [ ] ב-`vatMode='zero_rated'` מודפסת הערת שיעור אפס בשפת המסמך.
- [ ] הלוגו נטען מ-`/brand/alpir-logo.png`, ו-`logoDataUrl` מההגדרות דוחה אותו כשקיים.

### UI ו-UX

- [ ] כל מחיר שנמלא אוטומטית מציג מתחתיו את מקורו בטקסט מעומעם.
- [ ] אחרי עריכה ידנית של מחיר, המערכת אינה ממלאת אותו מחדש עבור אותה שורה.
- [ ] תיאור השורה נשאר שדה טקסט חופשי; בחירה מהקטלוג היא הצעה ולא חובה.
- [ ] בחירת חברה עם `country !== 'IL'` מציעה `language='en'` ו-`vatMode='zero_rated'` בהצעה הניתנת לדחייה.
- [ ] באנר מספר הקצאה מוצג כשהעסקה חוצה את הסף מול לקוח עם ח.פ., ומושתק כשאין רכיב מע״מ.
- [ ] הנפקה חסומה כשנבחר מטבע חוץ ללא שער המרה, עם הודעה מסבירה.
- [ ] הנפקה דורשת אישור מפורש בדיאלוג שמזכיר שלא ניתן לערוך אחרי הנפקה.
- [ ] מצב ריק מציג CTA ליצירת מסמך ראשון ולא רק "אין נתונים".

## Data Model

כל שינוי סכימה מבוצע בשלושה מקומות: `packages/database/src/schema.pg.ts` (מקור האמת לטיפוסים), `packages/database/src/schema.ts` (מראה SQLite), ובלוק bootstrap אידמפוטנטי ב-`packages/database/src/index.ts` בתבנית `VAT_ENTRIES_TABLE`. הטבלה והטיפוסים `$inferSelect`/`$inferInsert` מיוצאים מ-`index.ts`.

קונבנציות: `id` הוא `text` PK שנוצר באפליקציה; כספים נשמרים כ-`text` (`String(n)` בכתיבה, `parseFloat` בקריאה); תאריכים כ-`text` ISO; בוליאני כ-`integer` ב-SQLite ו-`boolean` ב-Postgres; אינדקסים בשם `idx_<table>_<cols>`.

### `companies` (חדשה)

| עמודה | טיפוס | הערות |
|---|---|---|
| `id` | text PK | `'co' + Date.now() + random` |
| `name` | text | notNull |
| `nameEn` | text | nullable |
| `taxId` | text | nullable — ח.פ. / עוסק מורשה |
| `taxIdType` | text | notNull, default `'company'` — `osek_morshe`\|`osek_patur`\|`company`\|`foreign`\|`other` |
| `address`, `city`, `zipCode` | text | nullable |
| `country` | text | notNull, default `'IL'` |
| `preferredLanguage` | text | notNull, default `'he'` — `he`\|`en` |
| `phone`, `email`, `website`, `notes` | text | nullable |
| `createdAt`, `updatedAt` | text | notNull, ISO |

אינדקסים: `idx_companies_name`, `idx_companies_tax_id`.

### `service_items` (חדשה)

| עמודה | טיפוס | הערות |
|---|---|---|
| `id` | text PK | `'si' + ...` |
| `name` | text | notNull |
| `nameEn`, `description` | text | nullable |
| `unit` | text | notNull, default `'item'` — `hour`\|`session`\|`day`\|`month`\|`project`\|`item` |
| `defaultUnitPrice` | text | notNull — כסף |
| `currency` | text | notNull, default `'ILS'` |
| `vatApplicable` | bool | notNull, default true |
| `isActive` | bool | notNull, default true |
| `sortOrder` | integer | notNull, default 0 |
| `createdAt`, `updatedAt` | text | notNull |

אינדקסים: `idx_service_items_name`, `idx_service_items_is_active`.

### `company_item_prices` (חדשה)

`id`, `companyId` (FK → `companies.id`, cascade), `serviceItemId` (FK → `service_items.id`, cascade), `unitPrice` (text), `currency` (default `ILS`), `note` (nullable), `createdAt`, `updatedAt`.
`uniqueIndex('uq_company_item_prices_pair')` על `(company_id, service_item_id)`.

### `sales_documents` (חדשה)

| עמודה | טיפוס | הערות |
|---|---|---|
| `id` | text PK | `'sd' + ...` |
| `docType` | text | notNull — ראה חוזה הסוגים |
| `docNumber` | integer | nullable עד הנפקה |
| `numberPrefix` | text | nullable, snapshot מההגדרות |
| `status` | text | notNull, default `'draft'` — `draft`\|`issued`\|`cancelled` |
| `language` | text | notNull, default `'he'` |
| `issueDate` | text | notNull |
| `dueDate`, `validUntil` | text | nullable |
| `companyId` | text | FK → `companies.id`, set null |
| `personId` | text | FK → `people.id`, set null |
| `clientName`, `clientTaxId`, `clientAddress`, `clientCountry`, `clientEmail`, `clientPhone` | text | snapshot בהנפקה |
| `issuerJson` | text | snapshot JSON של פרטי העוסק והלוגו |
| `currency` | text | notNull, default `'ILS'` |
| `exchangeRate` | text | nullable, חובה כשהמטבע אינו ILS |
| `totalIls` | text | notNull |
| `vatMode` | text | notNull, default `'standard'` |
| `vatRate` | text | notNull |
| `subtotal`, `vatAmount`, `total` | text | notNull |
| `notes`, `internalNotes` | text | nullable |
| `allocationNumber` | text | nullable |
| `relatedDocumentId`, `creditedByDocumentId` | text | FK self, set null |
| `vatEntryId` | text | nullable — מונע כפילות בסנכרון |
| `issuedAt`, `cancelledAt`, `cancelReason` | text | nullable |
| `createdAt`, `updatedAt` | text | notNull |

אינדקסים: `idx_sales_documents_doc_type`, `_status`, `_issue_date`, `_company_id`, `_related_document_id`, ו-`uniqueIndex('uq_sales_documents_type_number')` על `(doc_type, doc_number)` — NULL-ים מרובים מותרים בשני מנועי ה-DB, כך שטיוטות אינן מתנגשות.

### `sales_document_lines` (חדשה)

`id`, `documentId` (FK cascade), `serviceItemId` (FK set null), `priceSource` (`pinned`\|`history`\|`catalog`\|`manual`), `position` (integer), `description` (notNull), `quantity` (text), `unitPrice` (text), `discountPercent` (text nullable), `vatApplicable` (bool default true), `lineTotal` (text), `createdAt`.
אינדקסים: `idx_sales_document_lines_document_id`, `idx_sales_document_lines_service_item_id`.

### `sales_document_payments` (חדשה)

`id`, `documentId` (FK cascade), `method` (`cash`\|`bank_transfer`\|`check`\|`credit_card`\|`bit`\|`paypal`\|`other`), `amount` (text), `paidDate` (text), `reference` (nullable), `bankDetails` (nullable), `createdAt`.
אינדקס: `idx_sales_document_payments_document_id`.

### `sales_document_counters` (חדשה)

`id` (= `docType`), `docType` (text notNull), `lastNumber` (integer notNull default 0), `updatedAt`.

### שינויים בטבלאות קיימות

- `people` — עמודה חדשה `companyId TEXT REFERENCES companies(id) ON DELETE SET NULL` + `idx_people_company_id`. נוספת ל-`PEOPLE_COLUMNS` ב-`index.ts` כ-`ALTER TABLE people ADD COLUMN company_id TEXT`. השדה הקיים `people.company` (טקסט חופשי) נשאר לתאימות לאחור.
- `vat_entries` — עמודה חדשה `salesDocumentId TEXT` + `idx_vat_entries_sales_document_id`.
- `user_settings` — עמודה חדשה `businessProfile TEXT` (JSON blob בתבנית `agentDisplayNames`).

### מבנה `businessProfile`

```ts
type BusinessProfile = {
  businessName: string
  businessNameEn?: string
  ownerName?: string
  taxId?: string
  taxIdType?: 'osek_morshe' | 'osek_patur' | 'company'
  address?: string
  addressEn?: string
  city?: string
  zipCode?: string
  phone?: string
  email?: string
  website?: string
  logoDataUrl?: string
  bankDetails?: string
  bankDetailsEn?: string
  footerText?: string
  footerTextEn?: string
  defaultPaymentTerms?: string
  defaultLanguage?: 'he' | 'en'
  startNumbers?: Partial<Record<SalesDocumentType, number>>
}
```

## tRPC API

כל הפרוצדורות `protectedProcedure`. הראוטרים נרשמים ב-`appRouter` ב-`packages/api/src/index.ts`.

### `companiesRouter` — `packages/api/src/routers/companies.ts`

| פרוצדורה | סוג | קלט | פלט |
|---|---|---|---|
| `list` | query | `{ search?: string, limit?: number }` | `Company[]` |
| `get` | query | `{ id: string }` | `{ company, contacts: Person[] }` |
| `create` | mutation | `{ name, nameEn?, taxId?, taxIdType?, address?, city?, zipCode?, country?, preferredLanguage?, phone?, email?, website?, notes? }` | `{ id }` |
| `update` | mutation | `{ id, ...partial }` | `{ ok: true }` |
| `remove` | mutation | `{ id }` | `{ ok: true }` |

### `serviceItemsRouter` — `packages/api/src/routers/service-items.ts`

| פרוצדורה | סוג | קלט | פלט |
|---|---|---|---|
| `list` | query | `{ includeInactive?: boolean }` | `ServiceItem[]` |
| `create` | mutation | `{ name, nameEn?, description?, unit, defaultUnitPrice: number, currency?, vatApplicable? }` | `{ id }` |
| `update` | mutation | `{ id, ...partial }` | `{ ok: true }` |
| `archive` | mutation | `{ id }` | `{ ok: true }` — `isActive=false` |
| `pricesForClient` | query | `{ companyId?, personId?, currency? }` | `Record<serviceItemId, ResolvedPrice>` |
| `pinPrice` | mutation | `{ companyId, serviceItemId, unitPrice: number, currency?, note? }` | `{ ok: true }` |
| `unpinPrice` | mutation | `{ companyId, serviceItemId }` | `{ ok: true }` |

```ts
type ResolvedPrice = {
  unitPrice: number
  currency: string
  source: 'pinned' | 'history' | 'catalog'
  currencyMismatch: boolean
  lastUsedAt?: string
  lastDocumentId?: string
}
```

הכרעת המחיר יושבת ב-`packages/api/src/services/pricing-memory.ts` כפונקציה טהורה `resolveUnitPrice({ pinned, lastIssued, catalogDefault, documentCurrency })`, כדי שתיבדק ללא DB.

### `salesDocumentsRouter` — `packages/api/src/routers/sales-documents.ts`

| פרוצדורה | סוג | קלט | פלט |
|---|---|---|---|
| `list` | query | `{ docType?, status?, companyId?, year?, search?, limit? }` | שורות עם מספר, לקוח, סכום וסטטוס תשלום מחושב |
| `get` | query | `{ id }` | `{ document, lines, payments, company, related }` |
| `nextNumber` | query | `{ docType }` | `{ number, display }` — תצוגה מקדימה, אינו מקדם מונה |
| `createDraft` | mutation | `{ docType, language?, companyId?, personId?, issueDate, dueDate?, validUntil?, currency?, exchangeRate?, vatMode?, notes?, internalNotes?, relatedDocumentId?, lines: LineInput[], payments?: PaymentInput[] }` | `{ id }` |
| `updateDraft` | mutation | `{ id, ...partial }` | `{ ok: true }` — `CONFLICT` אם אינו טיוטה |
| `issue` | mutation | `{ id, allocationNumber? }` | `{ id, docNumber, vatEntryId? }` |
| `setAllocationNumber` | mutation | `{ id, allocationNumber }` | `{ ok: true }` |
| `addPayment` | mutation | `{ documentId, method, amount, paidDate, reference?, bankDetails? }` | `{ id }` |
| `removePayment` | mutation | `{ id }` | `{ ok: true }` |
| `cancel` | mutation | `{ id, reason }` | `{ ok: true }` — רק `quote`/`proforma` |
| `createCreditFor` | mutation | `{ taxInvoiceId, reason }` | `{ id }` |
| `convert` | mutation | `{ id, targetType }` | `{ id }` |
| `duplicate` | mutation | `{ id }` | `{ id }` |
| `remove` | mutation | `{ id }` | `{ ok: true }` — טיוטות בלבד |
| `summary` | query | `{ year }` | סכומים לפי סוג וסטטוס |

```ts
type LineInput = {
  serviceItemId?: string
  priceSource?: 'pinned' | 'history' | 'catalog' | 'manual'
  description: string
  quantity: number
  unitPrice: number
  discountPercent?: number
  vatApplicable?: boolean
}
```

### הרחבת `settingsRouter`

ראוטר מקונן `businessProfile: router({ get, set })` בתבנית `agentDisplayNames`, קורא וכותב את `user_settings.businessProfile` בשורה `id='default'`.

## UI Surface

### טאב חדש ב-`/finance`

`apps/web/src/app/finance/page.tsx` — הוספת `'documents'` למערך `TABS`, ל-tuple של סרגל הטאבים (`['documents', 'מסמכים', '🧾']`) ולרינדור מותנה עם `lazy()` + `Suspense`. גישה עמוקה דרך `/finance?tab=documents`. אין פריט ניווט חדש בסייד־בר.

### רכיבים חדשים

- `apps/web/src/app/finance/DocumentsTab.tsx` — פילטרים (סוג, סטטוס, שנה, חיפוש), טבלה בתוך `.card p-0 overflow-x-auto`, פעולות שורה ב-hover: הצג, הדפס, שכפל, המר, מחק (טיוטה בלבד).
- `apps/web/src/app/finance/components/DocumentFormModal.tsx` — `.overlay`/`.modal` עם `open`/`onClose`, מלכודת פוקוס ו-Escape בתבנית `QuickAddTaskModal`. כולל בורר שפה, מטבע, שער המרה ומצב מע״מ.
- `apps/web/src/app/finance/components/DocumentLinesEditor.tsx` — עורך שורות עם חישוב חי, השלמה אוטומטית מהקטלוג בשדה התיאור, מילוי מחיר לפי שרשרת העדיפויות, שורת מקור מחיר מתחת לשדה, וצ׳קבוקס "שמור כמחיר קבוע ללקוח".
- `apps/web/src/app/finance/components/PaymentModal.tsx` — הוספת תשלום למסמך.
- `apps/web/src/app/finance/components/DocumentPreview.tsx` — תבנית ויזואלית במיתוג Alpir, משותפת למודאל ולדף ההדפסה; מקבלת `language` ו-`dir`, וכל טקסט על הנייר נשלף מ-`DOCUMENT_STRINGS`.
- `apps/web/src/app/finance/documents/[id]/print/page.tsx` — דף עצמאי ללא `DashboardLayout`; מגדיר `dir` לפי שפת המסמך, `document.title` דרך `buildDocumentFileName`, ומריץ `window.print()`.
- `apps/web/src/app/settings/business/page.tsx` — פרטי עוסק בשתי השפות, העלאת לוגו עם תצוגה מקדימה, פרטי בנק מקומיים ובינלאומיים, שפת ברירת מחדל, מספרי התחלה.
- `apps/web/src/app/settings/companies/page.tsx` — ניהול חברות.
- `apps/web/src/app/settings/pricing/page.tsx` — קטלוג הפריטים.
- `apps/web/public/brand/alpir-logo.png` — נכס הלוגו.
- בלוק `@media print` ו-`@page { size: A4; margin: 14mm }` ב-`apps/web/src/app/globals.css`.
- הוספת בורר חברה ל-`apps/web/src/components/Modals/PersonModal.tsx`.

### שפה עיצובית של המסמך המודפס

נגזרת מהלוגו: רקע `#ffffff`, טקסט `#111111`, טורקיז הלוגו (`--doc-accent`) לקווי הפרדה, לכותרת ולשורת הסה״כ, אפור `#6b7280` לתוויות. בעברית Heebo (כבר נטען), באנגלית מחסנית סריף מקומית (`Georgia, 'Times New Roman', serif`) — בלי פונטים חיצוניים חדשים. הלוגו בראש הדף בצד הפתיחה, סוג המסמך ומספרו בפינה הנגדית. אזור התצוגה מבודד ב-CSS scope משלו כדי שהפלטה הבהירה לא תדלוף לכרומה הכהה.

### כללי UX מחייבים

- אין מילוי שקט של שדה כסף — כל מחיר אוטומטי מציג את מקורו.
- דגל שינוי ידני: אחרי עריכה, המערכת לא ממלאת את השדה מחדש.
- הקטלוג הוא הצעה ולא `select` נעול.
- שליפת מחירים אחת בבחירת הלקוח, כדי שמילוי שורה יהיה מיידי ובלי מצבי טעינה.
- הצעה חכמה ללקוח בחו״ל, שניתן לדחות.
- אישור מפורש לפני הנפקה, עם תזכורת שלא ניתן לערוך.
- פעולות הרסניות ב-`.btn-ghost` עם `#fb7185` — אין `.btn-danger` בפרויקט.
- כרומת האפליקציה נשארת `dir="rtl"` תמיד; רק תצוגת המסמך מתהפכת.

### מובייל

הטבלה גוללת אופקית בתוך `.card p-0 overflow-x-auto` בתבנית `VatTab`. המודאלים עוברים למסך מלא מתחת ל-639px דרך כללי `.overlay`/`.modal` הקיימים. יעדי מגע ≥44px.

## Out of Scope

- דיווח מע״מ או מקדמות אוטומטי לרשות המסים.
- חיבור API לרשות המסים לקבלת מספרי הקצאה — הזנה ידנית בלבד.
- שליפה אוטומטית של שערי מטבע — הזנה ידנית.
- שפות נוספות מעבר ל-`he`/`en`, ותרגום אוטומטי של תיאורי שורות.
- i18n לכרומת האפליקציה.
- מחירונים לפי תקופה או לפי כמות, והנחות אוטומטיות.
- מסך היסטוריית מחירים עם גרף מגמה — V1 מציג רק את המחיר האחרון ותאריכו.
- שליחת מייל ללקוח, העלאה אוטומטית ל-Google Drive, ותשלומים אונליין.
- מסמכי רכש ומסמכים תקופתיים.
- סנכרון אוטומטי של חשבונית זיכוי למע״מ — החתימה של `vat.create` דורשת `amount` חיובי, ולכן נדרש עדכון ידני.
- מיגרציית מסמכים היסטוריים מהמערכת החיצונית.

## Open Questions

- מספרי ההתחלה לכל סוג מסמך — נדרשים המספרים האחרונים מהמערכת הנוכחית לפני שימוש בפועל.
- האם לאשר עם רו״ח את פורמט המסמך ואת נוסח הערת שיעור אפס.
- האם נדרש מספר רישום זר (VAT ID) של לקוח חו״ל על המסמך, או שדי בשם וכתובת.
- האם השווה־ערך בשקלים צריך להופיע על המסמך המודפס באנגלית, או רק להישמר לדיווח.
- האם "מחיר קבוע ללקוח" נחוץ ב-V1, או שהמחיר האחרון מההיסטוריה מספיק.
- רשימת הפריטים ההתחלתית לקטלוג והמחיר הדיפולטיבי לכל אחד.
