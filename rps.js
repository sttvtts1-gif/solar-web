/*
 * RPS(고정가격 장기계약) 모듈 등급별 수익 비교 — 검색어플 RPS 탭의 계산을 그대로 옮겼다.
 * 원본: 검색어플/app/src/main/assets/index.html (buildYearlySeries, paybackFrom, SCORE_RULE, gradeSummary, analysisComment)
 *
 * 화면과 무관한 순수 계산. RPS.compute(inputs) 하나로 전부 돌려준다. 금액 단위: 시리즈는 천원, 요약은 원.
 */
const RPS = (() => {
  const GRADES = [
    { key: 1, label: '1등급', color: '#4f46e5' },
    { key: 2, label: '2등급', color: '#0ea5e9' },
    { key: 0, label: '무등급', color: '#94a3b8' },
  ];

  // 2026년 고정가격 입찰 기준. 1등급 대비 탄소검증 점수·우대가격 차이를 원/kWh로 환산한다.
  const SCORE_RULE = {
    ceilingPrice: 147.686, priceScoreMax: 70, recWeight: 1.5,
    carbonScore: { 1: 20, 2: 15, 0: 1 },
    preferredPrice: { 1: 16, 2: 7, 0: 0 },
  };
  // 1등급 단가에서 빼줄 등급별 차감액(원/kWh) — 2등급 29.3235, 무등급 84.1293
  function scoreGap(grade) {
    const pointWon = SCORE_RULE.ceilingPrice / SCORE_RULE.priceScoreMax;
    const carbonGap = (SCORE_RULE.carbonScore[1] - SCORE_RULE.carbonScore[grade]) * pointWon;
    const preferredGap = SCORE_RULE.preferredPrice[1] - SCORE_RULE.preferredPrice[grade];
    return SCORE_RULE.recWeight * (carbonGap + preferredGap);
  }
  // 상한가 기준 차감액 — 등급수익어플 기본값(202.354 / 188.854 / 178.354)에서 나온 고정 격차
  const CEILING_GAP = { 1: 0, 2: 13.5, 0: 24.0 };
  const gradePriceGap = (grade, ceilingBasis) => ceilingBasis ? CEILING_GAP[grade] : scoreGap(grade);

  const DEFAULTS = {
    capacity: 100,          // kW
    constCost: 150000000,   // 1등급 공사비(원)
    kepcoCost: 15000000,    // 한전분담금(원)
    baseGenTime: 3.6,       // 시간/일
    moduleAngle: 10,        // °
    loanActive: false,
    loanPrincipal: 120000000,
    loanInterest: 2.0,      // %
    loanGrace: 5,           // 년
    loanPeriod: 10,         // 년
    customPrice: 220,       // 1등급 고정가격단가(원/kWh)
    diff12: 60,             // 1→2등급 모듈 단가차액(원/Wp)
    diff1n: 135,            // 1→무등급
    ceilingBasis: false,
  };

  // 30년 현금흐름. 단가만 바꿔 여러 번 돌린다. (금액 단위: 천원)
  function buildYearlySeries({ capacity, baseGenTime, moduleAngle, price, loanActive, loanPrincipal, loanInterest, loanGrace, loanPeriod }) {
    const data = [];
    let cumulativeRevenue = 0, cumulativeProfit = 0, cumulativeCashFlow = 0;
    const baseAnnualOpCost = ((capacity <= 100 ? 75950 : 86590) * 12) + (capacity <= 100 ? 400000 : 700000);
    const mRate = ((parseFloat(loanInterest) || 0) / 100) / 12;
    const rMonths = loanPeriod * 12;
    const gMonths = loanGrace * 12;
    const mInstallment = (loanActive && mRate > 0 && rMonths > 0)
      ? (loanPrincipal * mRate * Math.pow(1 + mRate, rMonths)) / (Math.pow(1 + mRate, rMonths) - 1)
      : (loanActive && rMonths > 0 ? loanPrincipal / rMonths : 0);
    let currentLoanBalance = loanPrincipal;

    for (let year = 1; year <= 30; year++) {
      const eff = 0.99 - ((year - 1) * 0.004);
      const angAdj = moduleAngle === 10 ? 0 : (moduleAngle < 10 ? -3.29 + (moduleAngle - 5) * 0.658 : (moduleAngle - 10) * 0.48);
      const annualGeneration = capacity * (baseGenTime * (1 + angAdj / 100)) * 365 * eff;
      const annualRevenue = annualGeneration * price;
      const opCost = baseAnnualOpCost * Math.pow(1.02, year - 1);
      let yearlyInterest = 0, yearlyPrincipalRepay = 0;
      if (loanActive && year <= (loanGrace + loanPeriod)) {
        for (let m = 1; m <= 12; m++) {
          const curM = (year - 1) * 12 + m;
          if (curM <= gMonths) yearlyInterest += (currentLoanBalance * mRate);
          else if (curM <= (gMonths + rMonths)) {
            const interestPart = currentLoanBalance * mRate;
            const principalPart = mInstallment - interestPart;
            yearlyInterest += interestPart; yearlyPrincipalRepay += principalPart;
            currentLoanBalance = Math.max(0, currentLoanBalance - principalPart);
          }
        }
      }
      const annualNetProfit = annualRevenue - opCost - yearlyInterest;
      const annualCashOut = annualRevenue - opCost - (yearlyInterest + yearlyPrincipalRepay);
      cumulativeRevenue += annualRevenue; cumulativeProfit += annualNetProfit; cumulativeCashFlow += annualCashOut;
      data.push({
        year,
        generation: Math.round(annualGeneration),
        revenue: Math.round(annualRevenue / 1000), opCost: Math.round(opCost / 1000),
        loanInterest: Math.round(yearlyInterest / 1000), principalRepay: Math.round(yearlyPrincipalRepay / 1000),
        netCash: Math.round(annualCashOut / 1000), cumRevenue: Math.round(cumulativeRevenue / 1000),
        cumProfit: Math.round(cumulativeProfit / 1000), cumCash: Math.round(cumulativeCashFlow / 1000),
      });
    }
    return data;
  }

  // 자기자본을 회수하는 시점 (년/개월)
  function paybackFrom(series, equityWon) {
    const target = equityWon / 1000;
    const idx = series.findIndex(d => d.cumCash >= target);
    if (idx === -1) return { year: '-', month: '-' };
    const prevCumCash = idx > 0 ? series[idx - 1].cumCash : 0;
    const remaining = target - prevCumCash;
    const curYearCash = series[idx].netCash;
    let months = curYearCash > 0 ? Math.ceil((remaining / curYearCash) * 12) : 12;
    let finalYear = idx, finalMonth = months;
    if (finalMonth >= 12) { finalYear += 1; finalMonth = 0; }
    return { year: finalYear, month: finalMonth };
  }

  const formatWon = v => Math.round(v).toLocaleString('ko-KR');
  const signedWon = v => (v >= 0 ? '+' : '−') + Math.round(Math.abs(v)).toLocaleString('ko-KR');
  const payLabel = p => p.year === '-' ? '30년 내 미회수' : p.year + '년 ' + p.month + '개월';

  function compute(userIn) {
    const i = Object.assign({}, DEFAULTS, userIn || {});
    const capacity = Number(i.capacity) || 0;
    const loan = i.loanActive ? i.loanPrincipal : 0;
    const wp = capacity * 1000;

    const gradeConstCost = {
      1: i.constCost,
      2: Math.max(0, i.constCost - (Number(i.diff12) || 0) * wp),
      0: Math.max(0, i.constCost - (Number(i.diff1n) || 0) * wp),
    };
    const gradeTotalCost = { 1: gradeConstCost[1] + i.kepcoCost, 2: gradeConstCost[2] + i.kepcoCost, 0: gradeConstCost[0] + i.kepcoCost };
    const gradeEquity = { 1: gradeTotalCost[1] - loan, 2: gradeTotalCost[2] - loan, 0: gradeTotalCost[0] - loan };
    const gradePrice = {
      1: i.customPrice,
      2: Math.max(0, i.customPrice - gradePriceGap(2, i.ceilingBasis)),
      0: Math.max(0, i.customPrice - gradePriceGap(0, i.ceilingBasis)),
    };
    const base = { capacity, baseGenTime: i.baseGenTime, moduleAngle: i.moduleAngle, loanActive: i.loanActive, loanPrincipal: i.loanPrincipal, loanInterest: i.loanInterest, loanGrace: i.loanGrace, loanPeriod: i.loanPeriod };
    const gradeYearly = { 1: buildYearlySeries({ ...base, price: gradePrice[1] }), 2: buildYearlySeries({ ...base, price: gradePrice[2] }), 0: buildYearlySeries({ ...base, price: gradePrice[0] }) };
    const gradePayback = { 1: paybackFrom(gradeYearly[1], gradeEquity[1]), 2: paybackFrom(gradeYearly[2], gradeEquity[2]), 0: paybackFrom(gradeYearly[0], gradeEquity[0]) };

    // 30년 기준 등급별 총평 — 누적순익이 가장 큰 등급이 최종 추천
    const rows = GRADES.map(g => {
      const series = gradeYearly[g.key];
      const last = series[series.length - 1];
      return {
        ...g,
        price: gradePrice[g.key],
        constCost: gradeConstCost[g.key],
        totalCost: gradeTotalCost[g.key],
        equity: gradeEquity[g.key],
        annualRevenue: series[0].revenue * 1000,
        annualGeneration: series[0].generation,
        cumRevenue: last.cumRevenue * 1000,
        cumProfit: last.cumProfit * 1000,
        netProfit: last.cumProfit * 1000 - gradeTotalCost[g.key],
        costDiff: gradeConstCost[g.key] - gradeConstCost[1],
        revenueDiff: (last.cumRevenue - gradeYearly[1][29].cumRevenue) * 1000,
        payback: gradePayback[g.key],
      };
    });
    rows.forEach(r => { r.realDiff = r.revenueDiff - r.costDiff; });
    const best = rows.reduce((a, b) => (b.netProfit > a.netProfit ? b : a), rows[0]);

    // 매월 원리금상환액과 이자 (1등급 대출원금 기준, 원리금균등상환 1회차)
    let loanMonthly = null;
    if (i.loanActive) {
      const mRate = ((parseFloat(i.loanInterest) || 0) / 100) / 12;
      const graceMonths = i.loanGrace * 12;
      const repayMonths = i.loanPeriod * 12;
      const installment = (mRate > 0 && repayMonths > 0)
        ? (i.loanPrincipal * mRate * Math.pow(1 + mRate, repayMonths)) / (Math.pow(1 + mRate, repayMonths) - 1)
        : (repayMonths > 0 ? i.loanPrincipal / repayMonths : 0);
      const graceInterest = i.loanPrincipal * mRate;
      const repayInterest = i.loanPrincipal * mRate;
      loanMonthly = { graceMonths, repayStart: graceMonths + 1, repayEnd: graceMonths + repayMonths, graceInterest, repayPrincipal: installment - repayInterest, repayInterest, installment };
    }

    const comment = buildComment(rows, best, i, capacity);

    return { input: i, capacity, GRADES, gradeConstCost, gradeTotalCost, gradeEquity, gradePrice, gradeYearly, gradePayback, rows, best, loanMonthly, comment };
  }

  function buildComment(rows, best, i, capacity) {
    const byKey = k => rows.find(r => r.key === k);
    const g1 = byKey(1), g2 = byKey(2), g0 = byKey(0);
    const opCost = capacity <= 100 ? 1311400 : 1739080;
    const months = p => p.year === '-' ? null : Number(p.year) * 12 + Number(p.month);
    const base = months(g1.payback);

    const shift = r => {
      const m = months(r.payback);
      if (m === null) return '30년 내 회수되지 않습니다';
      if (base === null) return '회수기간은 ' + payLabel(r.payback) + '입니다';
      const d = m - base;
      if (d === 0) return '회수기간은 1등급과 같습니다';
      const y = Math.floor(Math.abs(d) / 12), mo = Math.abs(d) % 12;
      const dur = (y ? y + '년 ' : '') + mo + '개월';
      return '회수 시점은 ' + dur + ' ' + (d > 0 ? '늦어집니다' : '앞당겨집니다');
    };
    const costWord = r => {
      const d = r.totalCost - g1.totalCost;
      return '총 투자비가 ' + formatWon(Math.abs(d)) + '원 ' + (d < 0 ? '적지만' : '많지만');
    };
    const lowerGradesSlower = [g2, g0].every(r => { const m = months(r.payback); return m === null || (base !== null && m >= base); });

    const notes = [
      '2등급은 ' + costWord(g2) + ' ' + shift(g2) + '.',
      '무등급은 ' + costWord(g0) + ' ' + shift(g0) + '.',
      lowerGradesSlower
        ? '초기 투자비를 낮춰도 발전수익 감소폭이 더 커, 투자비 절감이 회수 시점 단축으로 이어지지 않습니다.'
        : '투자비 절감폭이 발전수익 감소폭을 상회해, 하위 등급에서 회수 시점이 앞당겨집니다.',
      '연 운영비 ' + formatWon(opCost) + '원은 용량과 무관한 정액 성격이라, 설비용량이 커질수록 kW당 부담이 줄어 모든 등급의 회수기간이 함께 짧아집니다 (현재 ' + capacity.toFixed(0) + 'kW 기준).',
      i.loanActive
        ? '위 회수기간은 대출 ' + formatWon(i.loanPrincipal) + '원을 제외한 자기자본 기준이며, 거치 ' + i.loanGrace + '년 동안은 이자만 부담해 초기 현금흐름 부담이 완만합니다.'
        : '위 회수기간은 전액 자기자본 기준이며, 대출을 적용하면 초기 투입금이 줄어 회수 시점이 앞당겨집니다.',
    ];
    return {
      headline: (i.ceilingBasis ? '상한가' : '가격점수 고려') + ' 기준으로 산정한 결과, ' + best.label + '이 총 투자비 ' + formatWon(best.totalCost) + '원에 회수기간 ' + payLabel(best.payback) + ', 30년 누적 실질순이익 ' + formatWon(best.netProfit) + '원으로 가장 유리합니다.',
      grades: rows.map(r => ({
        label: r.label, color: r.color,
        rows: [['총 투자비', formatWon(r.totalCost) + '원'], ['30년 누적순익', formatWon(r.cumProfit) + '원'], ['회수기간', payLabel(r.payback)]],
        favorable: r.key === 1 || (months(r.payback) !== null && base !== null && months(r.payback) <= base),
      })),
      notes,
    };
  }

  // 공유용 요약 텍스트 (검색어플 getSummaryText 의 RPS 분기)
  function summaryText(res, siteName) {
    const i = res.input;
    let t = '[그랜드썬기술단] 모듈 등급별 수익비교 결과 요약\n';
    if (siteName) t += '■ 대상지: ' + siteName + '\n';
    t += '\n■ 설비용량: ' + res.capacity.toFixed(3) + ' kW\n';
    if (i.loanActive) t += '■ 대출: ' + formatWon(i.loanPrincipal) + '원 (' + i.loanInterest + '%, ' + i.loanPeriod + '년 상환)\n';
    t += '■ 발전시간: ' + i.baseGenTime + '시간/일\n■ 단가 산정기준: ' + (i.ceilingBasis ? '상한가 기준' : '가격점수 고려') + '\n';
    res.rows.forEach(r => {
      t += '\n[' + r.label + ']\n· 고정가격단가: ' + r.price.toFixed(4) + '원/kWh\n· 공사비: ' + formatWon(r.constCost) + '원\n· 총 투자비: ' + formatWon(r.totalCost) + '원\n· 30년 누적순익: ' + formatWon(r.cumProfit) + '원\n· BEP: ' + payLabel(r.payback) + '\n';
      if (r.key !== 1) t += '· 1등급 대비 실 수익편차: ' + signedWon(r.realDiff) + '원\n';
    });
    t += '\n■ 분석 코멘트 (추천: ' + res.best.label + ')\n' + res.comment.headline + '\n';
    res.comment.grades.forEach(g => { t += '\n[' + g.label + ']\n' + g.rows.map(([k, v]) => '  · ' + k + ': ' + v).join('\n') + '\n'; });
    t += '\n' + res.comment.notes.map(l => '· ' + l).join('\n');
    return t;
  }

  // ------------------------------------------------------------ 자가소비 (검색어플 '자가소비' 탭)
  // 한전 요금표 — 자가소비 절감 계산은 중간부하 계절별 단가만 쓴다. 시간대 구분계량이 없는 갑Ⅰ 은 제외.
  const RATE_CATEGORIES = [
    { key: 'general_gap', label: '일반용(갑)' }, { key: 'general_eul', label: '일반용(을)' },
    { key: 'industrial_gap', label: '산업용(갑)' }, { key: 'industrial_eul', label: '산업용(을)' },
  ];
  const RATE_TABLE = {
    general_gap: {
      HighA: { label: '고압A', Select1: { summer: 140.6, springFall: 96.8, winter: 128.5 }, Select2: { summer: 135.3, springFall: 91.5, winter: 123.2 } },
      HighB: { label: '고압B', Select1: { summer: 137.4, springFall: 94.7, winter: 125.1 }, Select2: { summer: 132.1, springFall: 89.4, winter: 119.8 } },
    },
    general_eul: {
      HighA: { label: '고압A', Select1: { summer: 145.7, springFall: 115.3, winter: 145.9 }, Select2: { summer: 140.2, springFall: 109.8, winter: 140.4 }, Select3: { summer: 139.6, springFall: 108.5, winter: 139.8 } },
      HighB: { label: '고압B', Select1: { summer: 148.2, springFall: 118.2, winter: 148.2 }, Select2: { summer: 144.4, springFall: 114.4, winter: 144.4 }, Select3: { summer: 142.7, springFall: 112.8, winter: 142.7 } },
    },
    industrial_gap: {
      HighA: { label: '고압A', Select1: { summer: 121.5, springFall: 100.5, winter: 120.0 }, Select2: { summer: 116.6, springFall: 95.6, winter: 115.6 } },
      HighB: { label: '고압B', Select1: { summer: 120.1, springFall: 99.1, winter: 117.7 }, Select2: { summer: 115.6, springFall: 94.6, winter: 113.2 } },
    },
    industrial_eul: {
      HighA: { label: '고압A', Select1: { summer: 169.3, springFall: 138.9, winter: 169.5 }, Select2: { summer: 163.8, springFall: 133.4, winter: 164.0 }, Select3: { summer: 163.2, springFall: 132.1, winter: 163.4 } },
      HighB: { label: '고압B', Select1: { summer: 178.6, springFall: 148.6, winter: 178.6 }, Select2: { summer: 174.8, springFall: 144.8, winter: 174.8 }, Select3: { summer: 173.1, springFall: 143.2, winter: 173.1 } },
      HighC: { label: '고압C', Select1: { summer: 178.7, springFall: 148.7, winter: 178.3 }, Select2: { summer: 174.0, springFall: 144.0, winter: 173.6 }, Select3: { summer: 172.9, springFall: 142.9, winter: 172.5 } },
    },
  };
  const SELECT_LABEL = { Select1: '선택 I', Select2: '선택 II', Select3: '선택 III' };
  const SELF_DEFAULTS = { rateCategory: 'industrial_eul', voltageType: 'HighA', selectionType: 'Select3' };

  /**
   * 자가소비 절감. 단가 = 계절 중간부하 평균(소수 1자리), 월별 절감 = 발전량 × (기후환경 9.0 + 전력량 + 연료비조정 5.0).
   * 30년 시리즈·BEP 는 RPS 와 같은 buildYearlySeries 에 단가만 자가소비 단가로 넣는다.
   */
  function computeSelf(userIn) {
    const i = Object.assign({}, DEFAULTS, SELF_DEFAULTS, userIn || {});
    const cat = RATE_TABLE[i.rateCategory] ? i.rateCategory : 'industrial_eul';
    const grades = RATE_TABLE[cat];
    const volt = grades[i.voltageType] ? i.voltageType : Object.keys(grades)[0];
    const selKeys = Object.keys(grades[volt]).filter(k => k.startsWith('Select'));
    const sel = selKeys.includes(i.selectionType) ? i.selectionType : selKeys[selKeys.length - 1];
    const rates = grades[volt][sel];
    const savingRate = Math.round((rates.summer + rates.springFall + rates.winter) / 3 * 10) / 10;
    const capacity = Number(i.capacity) || 0;

    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const monthly = days.map((dn, idx) => {
      const m = idx + 1;
      const rate = (m >= 6 && m <= 8) ? rates.summer : (m === 11 || m === 12 || m === 1 || m === 2) ? rates.winter : rates.springFall;
      const gen = capacity * i.baseGenTime * dn * 0.99;
      const unit = 9.0 + rate + 5.0;
      return { month: m, climateFee: 9.0, energyCharge: rate, fuelAdj: 5.0, totalUnitRate: unit, gen: Math.round(gen), saving1Y: Math.round(gen * unit), saving20Y: Math.round(gen * unit * 20) };
    });
    const total1Y = monthly.reduce((a, b) => a + b.saving1Y, 0);
    const totalGen = monthly.reduce((a, b) => a + b.gen, 0);

    const totalInvestment = i.constCost + i.kepcoCost;
    const equity = totalInvestment - (i.loanActive ? i.loanPrincipal : 0);
    const yearly = buildYearlySeries({ capacity, baseGenTime: i.baseGenTime, moduleAngle: i.moduleAngle, price: savingRate, loanActive: i.loanActive, loanPrincipal: i.loanPrincipal, loanInterest: i.loanInterest, loanGrace: i.loanGrace, loanPeriod: i.loanPeriod });
    const payback = paybackFrom(yearly, equity);
    const avg20Y = yearly.slice(0, 20).reduce((a, b) => a + b.revenue * 1000, 0) / 20;

    return {
      input: i, capacity, rateCategory: cat, voltageType: volt, selectionType: sel, rates, savingRate,
      labels: { category: RATE_CATEGORIES.find(c => c.key === cat).label, voltage: grades[volt].label, selection: SELECT_LABEL[sel] },
      voltageKeys: Object.keys(grades), selectionKeys: selKeys,
      monthly, total1Y, totalGen, avgMonthly: total1Y / 12, avg20Y, co2t: totalGen * 0.4663 / 1000,
      totalInvestment, equity, yearly, payback,
    };
  }

  function selfSummaryText(res, siteName) {
    const i = res.input;
    let t = '[그랜드썬기술단] 자가소비 절감 분석 결과 요약\n';
    if (siteName) t += '■ 대상지: ' + siteName + '\n';
    t += '\n■ 설비용량: ' + res.capacity.toFixed(3) + ' kW\n';
    if (i.loanActive) t += '■ 대출: ' + formatWon(i.loanPrincipal) + '원 (' + i.loanInterest + '%, ' + i.loanPeriod + '년 상환)\n';
    t += '■ 요금제: ' + res.labels.category + ' ' + res.labels.voltage + ' ' + res.labels.selection + ' (중간부하 평균 ' + res.savingRate + '원/kWh)\n';
    t += '■ 총투자비: ' + formatWon(res.totalInvestment) + '원\n\n■ 연간 절감액: ' + (res.total1Y / 1e6).toFixed(2) + '백만\n■ 20년 누적절감액: ' + (res.total1Y * 20 / 1e6).toFixed(2) + '백만\n';
    t += '■ 온실가스 예상감축량: ' + res.co2t.toFixed(1) + ' tCO2/년\n■ BEP: ' + payLabel(res.payback);
    return t;
  }

  return { GRADES, DEFAULTS, compute, summaryText, gradePriceGap, formatWon, signedWon, payLabel,
           RATE_CATEGORIES, RATE_TABLE, SELECT_LABEL, SELF_DEFAULTS, computeSelf, selfSummaryText };
})();
