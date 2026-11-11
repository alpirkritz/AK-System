'use client'

/**
 * CFO Tab — Personal CFO & Financial Intelligence Module
 * 
 * Six sections: Dashboard, Leak Hunter, Debt Exit Plan, Liquidity Sweep,
 * Pension Audit, and Monthly Review
 */

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

export default function CfoTab() {
  const [activeSection, setActiveSection] = useState<'dashboard' | 'leaks' | 'debt' | 'liquidity' | 'pension' | 'monthly'>('dashboard')

  // Queries
  const profile = trpc.cfo.getProfile.useQuery()
  const debts = trpc.cfo.listDebts.useQuery()
  const policies = trpc.cfo.listPensionPolicies.useQuery()

  const sections = [
    { id: 'dashboard' as const, label: 'לוח בקרה' },
    { id: 'leaks' as const, label: 'ציד דליפות' },
    { id: 'debt' as const, label: 'תוכנית פירעון חובות' },
    { id: 'liquidity' as const, label: 'סוויפ נזילות' },
    { id: 'pension' as const, label: 'ביקורת פנסיה' },
    { id: 'monthly' as const, label: 'סקירה חודשית' },
  ]

  return (
    <div className="space-y-6">
      {/* Section Navigator */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => setActiveSection(section.id)}
            className={`
              px-4 py-2 rounded text-sm whitespace-nowrap transition-colors
              ${activeSection === section.id
                ? 'bg-[#2dd4bf] text-[#0e1626]'
                : 'bg-[#1a2332] text-[#8b9cc6] hover:bg-[#1f2937]'
              }
            `}
          >
            {section.label}
          </button>
        ))}
      </div>

      {/* Dashboard */}
      {activeSection === 'dashboard' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">לוח בקרה CFO</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Free Cash Card */}
            <div className="card p-4">
              <div className="text-sm text-[#8b9cc6] mb-1">מזומן חופשי חודשי</div>
              <div className="text-2xl font-bold text-[#2dd4bf]">
                {profile.data ? `${profile.data.freeCash.toFixed(0)} ₪` : '—'}
              </div>
              <div className="text-xs text-[#5a688c] mt-1">אחרי כל ההתחייבויות</div>
            </div>

            {/* Debt Status Card */}
            <div className="card p-4">
              <div className="text-sm text-[#8b9cc6] mb-1">מצב חובות</div>
              <div className="text-2xl font-bold text-[#fb7185]">
                {debts.data ? `${debts.data.length} חובות` : '—'}
              </div>
              <div className="text-xs text-[#5a688c] mt-1">לחץ על "תוכנית פירעון" לפרטים</div>
            </div>

            {/* Sweep Status Card */}
            <div className="card p-4">
              <div className="text-sm text-[#8b9cc6] mb-1">סטטוס סוויפ</div>
              <div className="text-2xl font-bold text-[#38bdf8]">OK</div>
              <div className="text-xs text-[#5a688c] mt-1">יתרה מאוזנת</div>
            </div>
          </div>
        </div>
      )}

      {/* Leak Hunter */}
      {activeSection === 'leaks' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">ציד דליפות</h2>
          <p className="text-sm text-[#8b9cc6]">
            ניתוח חיובים חוזרים, זיהוי עליות מחיר ומינויים לא פעילים
          </p>
          
          <div className="card p-6 text-center">
            <p className="text-[#8b9cc6]">הפיצ'ר יופעל עם נתוני עסקאות מלאים</p>
            <p className="text-sm text-[#5a688c] mt-2">
              חבר חשבון בנק או כרטיס אשראי בטאב "חשבונות" כדי להפעיל
            </p>
          </div>
        </div>
      )}

      {/* Debt Exit Plan */}
      {activeSection === 'debt' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">תוכנית פירעון חובות (Avalanche)</h2>
          
          {debts.data && debts.data.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-[#2dd4bf] text-lg mb-2">🎉 אין חובות!</p>
              <p className="text-sm text-[#8b9cc6]">
                רוצה להוסיף חוב למעקב? לחץ על "הוסף חוב" למעלה
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {debts.data?.map((debt) => (
                <div key={debt.id} className="card p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-[#e4ebfa]">{debt.name}</div>
                      <div className="text-sm text-[#8b9cc6] mt-1">
                        יתרה: {debt.balance.toFixed(0)} ₪ • APR: {(debt.apr * 100).toFixed(1)}%
                      </div>
                    </div>
                    <span className="text-xs px-2 py-1 rounded bg-[#1a2332] text-[#8b9cc6]">
                      {debt.debtType}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Liquidity Sweep */}
      {activeSection === 'liquidity' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">סוויפ נזילות תלת-שכבתי</h2>
          <p className="text-sm text-[#8b9cc6]">
            הקצאת מזומנים: תפעולי (L1) • קרן חירום (L2) • כסף מתוכנן (L3)
          </p>
          
          <div className="card p-6">
            <div className="space-y-4">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8b9cc6]">Layer 1: תפעולי</span>
                  <span className="text-[#e4ebfa]">17,000 ₪</span>
                </div>
                <div className="h-2 bg-[#1a2332] rounded overflow-hidden">
                  <div className="h-full bg-[#2dd4bf]" style={{ width: '34%' }} />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8b9cc6]">Layer 2: חירום</span>
                  <span className="text-[#e4ebfa]">40,000 ₪</span>
                </div>
                <div className="h-2 bg-[#1a2332] rounded overflow-hidden">
                  <div className="h-full bg-[#38bdf8]" style={{ width: '50%' }} />
                </div>
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-[#8b9cc6]">Layer 3: מתוכנן</span>
                  <span className="text-[#e4ebfa]">43,000 ₪</span>
                </div>
                <div className="h-2 bg-[#1a2332] rounded overflow-hidden">
                  <div className="h-full bg-[#f472b6]" style={{ width: '16%' }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pension Audit */}
      {activeSection === 'pension' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">ביקורת פנסיה וחסכון ארוך טווח</h2>
          
          {policies.data && policies.data.length === 0 ? (
            <div className="card p-6 text-center">
              <p className="text-[#8b9cc6] mb-2">לא הוגדרו פוליסות</p>
              <p className="text-sm text-[#5a688c]">
                הוסף פוליסות פנסיה/ביטוח כדי לבדוק עמלות מול תקרה רגולטורית
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {policies.data?.map((policy) => (
                <div key={policy.id} className="card p-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="font-semibold text-[#e4ebfa]">{policy.provider}</div>
                      <div className="text-sm text-[#8b9cc6] mt-1">
                        {policy.policyType} • יתרה: {policy.balance.toFixed(0)} ₪
                      </div>
                      <div className="text-xs text-[#5a688c] mt-1">
                        עמלות: {(policy.depositFeePct * 100).toFixed(2)}% הפקדות, {(policy.accumFeePct * 100).toFixed(3)}% צבירה
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Monthly Review */}
      {activeSection === 'monthly' && (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-[#e4ebfa]">סקירה חודשית</h2>
          <p className="text-sm text-[#8b9cc6]">
            אנומליות, בדיקת סוויפ ורשימה adversarial
          </p>
          
          <div className="card p-6">
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-[#e4ebfa] mb-2">אנומליות (חריגות מהממוצע)</h3>
                <p className="text-sm text-[#5a688c]">לא זוהו חריגות משמעותיות החודש</p>
              </div>
              
              <div className="border-t border-[#1a2332] pt-4">
                <h3 className="text-sm font-semibold text-[#e4ebfa] mb-2">רשימת פעולות מומלצות</h3>
                <ul className="space-y-2 text-sm text-[#8b9cc6]">
                  <li className="flex items-start gap-2">
                    <span className="text-[#2dd4bf]">1.</span>
                    <span>לבנות קרן חירום מלאה (3-6 חודשים)</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#2dd4bf]">2.</span>
                    <span>לבדוק עמלות פנסיה מול תקרה רגולטורית</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-[#2dd4bf]">3.</span>
                    <span>להעביר עודף Layer 1 להשקעה</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
