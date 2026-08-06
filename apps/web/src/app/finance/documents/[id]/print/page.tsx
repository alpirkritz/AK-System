'use client'

import { useEffect } from 'react'
import { useParams } from 'next/navigation'
import { buildDocumentFileName } from '@ak-system/types'
import type { DocumentLanguage, SalesDocumentType } from '@ak-system/types'
import { trpc } from '@/lib/trpc'
import { DocumentPreview } from '../../../components/DocumentPreview'

/**
 * Standalone page without DashboardLayout: the paper has to be the only thing
 * on the sheet. Chrome takes document.title as the suggested PDF file name.
 */
export default function DocumentPrintPage() {
  const params = useParams<{ id: string }>()
  const id = typeof params?.id === 'string' ? params.id : ''
  const { data, isLoading } = trpc.salesDocuments.get.useQuery({ id }, { enabled: Boolean(id) })

  const doc = data?.document

  useEffect(() => {
    if (!doc) return
    const language: DocumentLanguage = doc.language === 'en' ? 'en' : 'he'
    document.title = buildDocumentFileName(
      {
        docType: doc.docType as SalesDocumentType,
        docNumber: doc.docNumber,
        issueDate: doc.issueDate,
        language,
      },
      language
    )
  }, [doc])

  if (!id || isLoading) {
    return <div className="p-8 text-sm text-[#5a688c]">טוען...</div>
  }

  if (!doc) {
    return <div className="p-8 text-sm text-[#fb7185]">המסמך לא נמצא.</div>
  }

  return (
    <div style={{ background: '#e9edf2', minHeight: '100vh', padding: '24px 0' }}>
      <div className="no-print flex justify-center gap-2 mb-4">
        <button className="btn btn-primary text-sm" onClick={() => window.print()}>
          הדפס / שמור כ-PDF
        </button>
        <button className="btn btn-ghost text-sm" onClick={() => window.close()}>
          סגור
        </button>
      </div>

      <DocumentPreview
        document={doc}
        lines={data.lines}
        payments={data.payments}
        issuer={data.issuer}
        relatedNumber={data.related?.docNumber ?? null}
      />
    </div>
  )
}
