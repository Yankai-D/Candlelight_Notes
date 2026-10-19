// Enforce ceilings at the provider boundary, including internal retries.
// Preserve request/response evidence without authentication headers or keys.
export function meteredFetcher(fetcher, budget, trace) {
  let calls=0, reservedCompletion=0;
  const deny = code => { bounded.blockedReason=code;throw new Error(code); };
  const bounded = async (url, options) => {
    if (calls >= budget.maxCalls) deny('EVAL_CALL_BUDGET');
    const body=JSON.parse(options.body);
    if (JSON.stringify(body.messages).length > budget.maxPromptCharacters) deny('EVAL_CONTEXT_BUDGET');
    const available=budget.totalCompletionTokens-reservedCompletion;
    if (available<1) deny('EVAL_TOKEN_BUDGET');
    const allowance=Math.min(budget.maxCompletionTokens,available,body.max_tokens);
    body.max_tokens=allowance;body.temperature=budget.temperature;
    const item={call:++calls,request:body,status:'pending',reservedCompletionTokens:allowance,startedAt:new Date().toISOString()};
    trace.push(item);reservedCompletion+=allowance;
    const started=performance.now();
    try {
      const response=await fetcher(url,{...options,body:JSON.stringify(body)});
      item.httpStatus=response.status;
      if(response.ok) {
        const data=await response.clone().json();
        item.response=data;item.status='received';
        const used=data.usage?.completion_tokens;
        if(Number.isSafeInteger(used)&&used>=0&&used<=allowance) reservedCompletion-=allowance-used;
      } else item.status='http-error';
      return response;
    } catch(error) { item.status='transport-error';item.errorCode=error.code||error.name;throw error; }
    finally {item.elapsedMs=Math.round(performance.now()-started);item.chargedCompletionTokens=reservedCompletion;}
  };
  return bounded;
}
