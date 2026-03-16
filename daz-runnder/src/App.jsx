import React, { useState, useMemo } from 'react';
import {
  Scale,
  Flame,
  Zap,
  Target,
  Rocket,
  TrendingDown,
} from 'lucide-react';

const App = () => {
  const [marketVelocity, setMarketVelocity] = useState(50); // 0-100
  const [tractionLevel, setTractionLevel] = useState(0); // 0: Idea, 1: POC, 2: Sales
  const [activeScenario, setActiveScenario] = useState(null);

  const tractionLabels = ["רעיון / מצגת", "MVP / POC עובד", "מכירות ראשוניות (Revenue)"];

  const scenarios = useMemo(() => [
    {
      id: 'bootstrap',
      title: 'Bootstrap (אורגני)',
      funding: 0,
      equity: 100,
      baseSpeed: 20,
      baseRisk: 40,
      description: 'בנייה איטית מבוססת משאבים פנימיים. שליטה מלאה, תלות מוחלטת בקצב המכירות.',
      dilemma: 'האם המותג שלנו יישאר רלוונטי אם נגיע לשוק רק בעוד 18 חודשים?'
    },
    {
      id: 'seed_lean',
      title: 'Lean Seed ($450k)',
      funding: 450000,
      equity: 85,
      baseSpeed: 60,
      baseRisk: 25,
      baseFundingProb: 65,
      description: 'גיוס "חכם" להוכחת התאמה לשוק (PMF). מאפשר בניית צוות ליבה איכותי.',
      dilemma: 'האם זה מספיק דלק כדי לנצח מתחרים שגייסו פי 5 מאיתנו?'
    },
    {
      id: 'seed_agg',
      title: 'Aggressive ($1.2M)',
      funding: 1200000,
      equity: 72,
      baseSpeed: 95,
      baseRisk: 30,
      baseFundingProb: 25,
      description: 'מרוץ חימוש. השתלטות על השוק דרך הון מאסיבי וצמיחה מהירה.',
      dilemma: 'בלי טרקשן משמעותי, האם אנחנו לא שורפים את השם שלנו מול VCs בכירים?'
    }
  ], []);

  const calculateData = (scenario) => {
    const vFactor = marketVelocity / 100;
    const tFactor = tractionLevel / 2;

    // Relevance Risk: High velocity + Low funding = High risk of being obsolete
    let relevanceRisk = scenario.id === 'bootstrap'
      ? Math.min(100, scenario.baseRisk + (vFactor * 100) - (tFactor * 40))
      : Math.max(10, scenario.baseRisk + (vFactor * 25) - (tFactor * 20));

    // Funding Probability: Traction is the biggest multiplier.
    // Trying to raise $1.2M on an idea in a fast market is a suicide mission.
    let fundingProb;
    if (scenario.id === 'bootstrap') {
      fundingProb = 100;
    } else {
      const tractionBonus = tractionLevel * 30;
      const marketPenalty = vFactor * 25;
      const sizePenalty = scenario.id === 'seed_agg' ? 20 : 0;
      fundingProb = Math.max(5, Math.min(95, scenario.baseFundingProb + tractionBonus - marketPenalty - sizePenalty));
    }

    return { ...scenario, relevanceRisk, fundingProb };
  };

  return (
    <div className="min-h-screen bg-[#fcfcfd] p-4 md:p-12 font-sans text-slate-900" dir="rtl">
      <header className="max-w-6xl mx-auto mb-12 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-4xl font-black text-slate-900 tracking-tight flex items-center gap-3">
            <Scale className="text-indigo-600" size={36} />
            דאז: סימולטור ולידציה והון
          </h1>
          <p className="text-slate-500 mt-2 text-lg">ניתוח הסתברותי להחלטה אסטרטגית בין שותפים</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white border border-slate-200 px-4 py-2 rounded-2xl shadow-sm text-center">
            <span className="block text-[10px] font-bold text-slate-400 uppercase">Market State</span>
            <span className={`text-sm font-bold ${marketVelocity > 70 ? 'text-orange-600' : 'text-emerald-600'}`}>
              {marketVelocity > 70 ? 'Hyper-Competitive' : 'Stable'}
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto space-y-8">
        {/* Strategic Sliders */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
             <div className="relative z-10">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  <Flame className={marketVelocity > 70 ? "text-orange-500" : "text-blue-400"} />
                  מהירות השוק (Velocity)
                </h2>
                <input
                  type="range" min="0" max="100" value={marketVelocity}
                  onChange={(e) => setMarketVelocity(parseInt(e.target.value))}
                  className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                />
                <div className="flex justify-between text-[10px] font-bold mt-2 text-slate-500 uppercase tracking-widest">
                  <span>שוק איטי</span>
                  <span>מרוץ חימוש</span>
                </div>
                <p className="text-xs text-slate-400 mt-4 leading-relaxed">
                  ככל שהשוק מהיר יותר, משקיעים דורשים יותר הוכחות (Traction) כדי לשים סכומים גדולים.
                </p>
             </div>
          </div>

          <div className="bg-indigo-900 text-white p-8 rounded-[2.5rem] shadow-2xl">
             <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
               <Zap className="text-yellow-400" />
               רמת טרקשן (Validation)
             </h2>
             <input
               type="range" min="0" max="2" step="1" value={tractionLevel}
               onChange={(e) => setTractionLevel(parseInt(e.target.value))}
               className="w-full h-2 bg-indigo-800 rounded-lg appearance-none cursor-pointer accent-yellow-400"
             />
             <div className="flex justify-between text-[10px] font-bold mt-2 text-indigo-300 uppercase tracking-widest">
               <span>{tractionLabels[0]}</span>
               <span>{tractionLabels[1]}</span>
               <span>{tractionLabels[2]}</span>
             </div>
             <p className="text-xs text-indigo-200/60 mt-4 leading-relaxed">
               מכירות ראשוניות הן "מכפיל הכוח" הכי חזק שלכם. בלי זה, הגיוס הוא תהליך של ניחושים.
             </p>
          </div>
        </div>

        {/* Results Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {scenarios.map((s) => {
            const data = calculateData(s);
            return (
              <div
                key={s.id}
                className={`group transition-all duration-500 bg-white rounded-[2rem] border-2 p-8 flex flex-col space-y-6 ${activeScenario === s.id ? 'border-indigo-500 shadow-2xl scale-[1.03]' : 'border-transparent shadow-sm hover:border-slate-200'}`}
                onClick={() => setActiveScenario(s.id)}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-2xl font-black text-slate-800">{s.title}</h3>
                    <p className="text-xs text-slate-400 font-bold uppercase tracking-tight mt-1">${s.funding.toLocaleString()}</p>
                  </div>
                  <div className={`p-2 rounded-xl ${data.fundingProb > 70 ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-50 text-slate-400'}`}>
                    <Target size={20} />
                  </div>
                </div>

                <div className="space-y-5">
                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-2">
                      <span className="text-slate-500">סיכוי הצלחה בגיוס</span>
                      <span className={data.fundingProb < 35 ? 'text-red-500' : 'text-emerald-600'}>{data.fundingProb.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                      <div className={`h-full transition-all duration-1000 ${data.fundingProb < 35 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${data.fundingProb}%` }} />
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-[11px] font-bold mb-2">
                      <span className="text-slate-500">סיכון אי-רלוונטיות (Market Risk)</span>
                      <span className={data.relevanceRisk > 60 ? 'text-orange-600' : 'text-slate-400'}>{data.relevanceRisk.toFixed(0)}%</span>
                    </div>
                    <div className="w-full bg-slate-100 h-1.5 rounded-full">
                      <div className="bg-slate-900 h-full transition-all duration-500" style={{ width: `${data.relevanceRisk}%` }} />
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 italic text-xs text-slate-600 leading-relaxed">
                   &quot;{s.description}&quot;
                </div>

                <div className="pt-4 border-t border-slate-100 flex justify-between items-end mt-auto">
                   <div>
                     <span className="block text-[10px] text-slate-400 font-bold uppercase">Equity Left</span>
                     <span className="text-2xl font-black text-slate-800">{s.equity}%</span>
                   </div>
                   <div className="bg-indigo-50 px-3 py-1 rounded-lg">
                      <span className="text-[10px] font-bold text-indigo-600 uppercase">Potential Exit</span>
                   </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* The Challenge Section */}
        <div className="bg-white border-2 border-slate-200 rounded-[2.5rem] p-10 shadow-sm overflow-hidden relative">
          <div className="flex flex-col md:flex-row gap-12 items-center relative z-10">
            <div className="flex-1 space-y-6">
              <h2 className="text-3xl font-black text-slate-900 leading-none">הדילמה שעל השולחן:</h2>
              <p className="text-lg text-slate-600 leading-relaxed">
                גיוס של <strong>$1.2M</strong> במצב של &quot;רעיון בלבד&quot; הוא כמעט בלתי אפשרי בשוק מהיר. זה הימור שיכול לעלות לכם בחצי שנה של פגישות ריקות בזמן שהמתחרים בונים.
              </p>
              <div className="flex flex-wrap gap-4">
                <div className="flex items-center gap-2 bg-red-50 text-red-700 px-4 py-2 rounded-full text-sm font-bold border border-red-100">
                  <TrendingDown size={18} />
                  סיכון גבוה ל-Failed Round
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-4 py-2 rounded-full text-sm font-bold border border-indigo-100">
                  <Rocket size={18} />
                  מכירות מעלות שווי ב-300%
                </div>
              </div>
            </div>

            <div className="w-full md:w-80 space-y-4">
              <div className="bg-slate-900 p-6 rounded-3xl text-white">
                <h4 className="text-xs font-bold text-slate-500 uppercase mb-4 tracking-widest">נקודות למחשבה לשותפים</h4>
                <ul className="space-y-4 text-sm">
                  <li className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                    <span>האם נסכים לגייס פחות ($450k) כדי לסגור סבב תוך חודש?</span>
                  </li>
                  <li className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-indigo-500 mt-1.5 shrink-0" />
                    <span>מה הדבר היחיד שיכול להביא לנו לקוח משלם מחר?</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto mt-12 text-center text-slate-400 text-[10px] uppercase tracking-widest pb-10">
        Daz Confidential Strategic Asset // Alpir Kritzler Edition
      </footer>
    </div>
  );
};

export default App;
