// Test-only breadcrumbs distinguish a delayed process launch from synchronous imports.
const beginning=Date.now();
function note(stage,extra={}){process.stderr.write('[QGauss startup] '+JSON.stringify({stage,pid:process.pid,elapsedMs:Date.now()-beginning,...extra})+'\n');}
note('node-preload',{node:process.version});
setImmediate(()=>note('first-event-loop',{rssMb:Math.round(process.memoryUsage().rss/1048576)}));
process.once('uncaughtExceptionMonitor',error=>note('uncaught',{kind:error?.name||'Error'}));
process.once('exit',code=>note('exit',{code}));
