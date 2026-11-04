export function quoteDetails(rate){
 if(!rate.quoteMethod)return [];
 const methods={min:'최저',max:'최고',average:'평균',selected:'지정',manual:'직접 입력'},rounding={none:'처리 안 함',floor:'절하',ceil:'절상',round:'반올림'};
 const rows=[['적용일',rate.quoteDate||'미입력'],['적용 방법',methods[rate.quoteMethod]||rate.quoteMethod],['끝자리 처리',(rounding[rate.quoteRounding?.mode]||'기존 설정')+' / 소수 자리 '+(rate.quoteRounding?.digits??0)],['부가세 처리',{none:'변환 안 함',include:'공급가 → 포함가',exclude:'포함가 → 공급가'}[rate.vatConversion?.mode||'none']+' / '+(rate.vatConversion?.rate??10)+'%']];
 for(let i=0;i<6;i++)rows.push([rate.quoteSources?.[i]||'조사단가 '+(i+1),rate.prices?.[i]??'미입력',rate.quotePages?.[i]||'',rate.quoteMethod==='selected'&&rate.quoteSelection===i?'선택':'']);
 if(rate.quoteMethod==='manual')rows.push(['직접 입력',rate.quoteManual]);
 rows.push(['적용 단가',rate.total]);return rows;
}
export function safetyDetails(charge){
 const c=charge.comparison;if(!c)return [];
 const inputs=charge.comparisonInputs;
 return [...(inputs? [['대상액',inputs.base],['관급 포함액',inputs.government],['요율(%)',inputs.rate],['기초액',inputs.addition],['할증률(%)',inputs.surcharge]]:[]),['관급 포함 A',c.withGovernment],['할증 B',c.withSurcharge],['비교 시 선택 금액',c.selected],['현재 적용 금액',charge.fixed],['집계 안내','A·B는 비교 표시이며 별도로 합산하지 않습니다.']];
}
