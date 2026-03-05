'use client'

import { UserPlus, SearchX, AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  type: 'no-data' | 'no-results' | 'error'
  onAddPerson?: () => void
  onClearFilters?: () => void
  onRetry?: () => void
}

export function PeopleEmptyState({ type, onAddPerson, onClearFilters, onRetry }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {type === 'no-data' && (
        <>
          <div className="w-14 h-14 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
            <UserPlus className="w-6 h-6 text-[#555]" />
          </div>
          <h3 className="text-base font-semibold text-[#f0ede6] mb-1">אין אנשים עדיין</h3>
          <p className="text-sm text-[#666] mb-5">הוסף את איש הקשר הראשון שלך כדי להתחיל</p>
          {onAddPerson && (
            <button className="btn btn-primary flex items-center gap-2" onClick={onAddPerson}>
              <UserPlus className="w-4 h-4" />
              הוסף איש קשר
            </button>
          )}
        </>
      )}

      {type === 'no-results' && (
        <>
          <div className="w-14 h-14 rounded-full bg-[#1a1a1a] flex items-center justify-center mb-4">
            <SearchX className="w-6 h-6 text-[#555]" />
          </div>
          <h3 className="text-base font-semibold text-[#f0ede6] mb-1">לא נמצאו תוצאות</h3>
          <p className="text-sm text-[#666] mb-5">נסה לשנות את החיפוש או הפילטרים</p>
          {onClearFilters && (
            <button className="btn btn-ghost" onClick={onClearFilters}>
              נקה פילטרים
            </button>
          )}
        </>
      )}

      {type === 'error' && (
        <>
          <div className="w-14 h-14 rounded-full bg-error/10 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-error" />
          </div>
          <h3 className="text-base font-semibold text-[#f0ede6] mb-1">שגיאה בטעינת הנתונים</h3>
          <p className="text-sm text-[#666] mb-5">אירעה שגיאה, נסה שוב</p>
          {onRetry && (
            <button className="btn btn-ghost flex items-center gap-2" onClick={onRetry}>
              <RefreshCw className="w-4 h-4" />
              נסה שוב
            </button>
          )}
        </>
      )}
    </div>
  )
}
