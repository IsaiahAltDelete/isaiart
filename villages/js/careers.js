// Rotating education seats and local graduate placement. Productive staff keep their jobs.
import {defOf,stageOf,workersOf,DAY} from './sim.js';
import {jobFit,classOf} from './rpg.js';
import {JOB_EDU} from './education.js';
export const careerReady=(sim,v)=>stageOf(v)==='adult'&&!v.quest&&!(v.jail>sim.s.time)&&!(v.ko>0)&&!v.downed;
const teaches=(sim,b)=>b.workers.some(id=>{const t=sim.vById.get(id);return t&&careerReady(sim,t)&&t.job==='professor';});
export function installCareers(sim){
  if(sim.s.autoCareers===undefined)sim.s.autoCareers=true;
  sim.careerOptions=v=>sim.s.buildings.filter(b=>b.built&&!b.up&&b.sid===v.home&&defOf(b.type).workers&&defOf(b.type).job!=='scholar'&&b.workers.length<workersOf(b)&&sim.canDoJob(v,defOf(b.type).job))
    .map(b=>{const job=defOf(b.type).job,fit=jobFit(v,job),needed=(job==='teacher'&&sim.s.villagers.some(o=>o.home===b.sid&&stageOf(o)==='child'&&o.age>=5))||(job==='professor'&&!b.workers.length);
      const matches={wizard:'wizard',acolyte:'cleric',trainer:'fighter',scout:'ranger',locksmith:'rogue',bard:'bard'};
      return {b,fit,needed,score:fit+(JOB_EDU[job]||0)*2+(needed?8:0)+(matches[job]===classOf(v)?5:0)};})
    .sort((a,b)=>b.score-a.score||a.b.id-b.b.id);
  sim.advanceCareer=(v,graduated=false)=>{
    if(sim.s.autoCareers===false||v.autoCareer===false||!careerReady(sim,v)||!['idle','scholar'].includes(v.job))return false;
    const options=sim.careerOptions(v),faculty=options.find(o=>o.needed&&['teacher','professor'].includes(defOf(o.b.type).job)&&o.fit>=0);
    if(faculty&&sim.assign(faculty.b,v)){v.careerNote='Teaching the next generation';sim.log(`${v.name} took a teaching post after study.`);return true;}
    const uni=sim.s.buildings.find(b=>b.type==='university'&&b.sid===v.home&&b.built&&!b.up&&teaches(sim,b)&&sim.universityStudents(b).length<4+((b.lvl||1)-1)*2);
    if(uni&&!(v.universityAfter>sim.s.time)&&sim.universityEligible(v)&&(sim.policyOn('freeSchool')||(v.purse||0)>=4)&&sim.enrol(v,uni)){v.careerNote='Continuing to Magister studies';return true;}
    const good=options.find(o=>o.fit>=0);
    if(good&&sim.assign(good.b,v)){v.careerNote='Placed in suitable local work';sim.log(`${v.name} moved into work at ${sim.homeName(good.b)}.`);return true;}
    if(graduated&&sim.eduTier(v)>=3&&v.job==='scholar'){sim.unassign(v);v.studyAfter=sim.s.time+DAY;v.careerNote='Graduated; waiting for suitable work';return true;}
    return false;
  };
  const library=sim.taskLibrary.bind(sim);
  sim.taskLibrary=(v,b)=>{library(v,b);const act=v.task.steps.find(s=>s.act),done=act.done,tier=sim.eduTier(v);act.done=()=>{
    if(!sim.bById.has(b.id)||b.up||v.work!==b.id||!careerReady(sim,v))return;
    done();if(sim.eduTier(v)>tier||sim.eduTier(v)>=3)sim.advanceCareer(v,true);
  };};
  sim.careerSecond=()=>{
    if(sim.s.autoCareers===false)return;
    const folk=sim.s.villagers.filter(v=>careerReady(sim,v)&&v.autoCareer!==false).sort((a,b)=>(a.lastStudy||0)-(b.lastStudy||0)||a.id-b.id);
    for(const v of folk){
      if(v.job==='student'){
        const b=sim.bById.get(v.work),ready=b?.built&&!b.up&&teaches(sim,b)&&(sim.policyOn('freeSchool')||(v.purse||0)>=.5);
        if(ready)v.careerBlockedAt=null;
        else{v.careerBlockedAt??=sim.s.time;if(sim.s.time-v.careerBlockedAt>=60){sim.unassign(v);v.universityAfter=sim.s.time+DAY;v.careerBlockedAt=null;v.careerNote='Study paused; saving for tuition or waiting for faculty';sim.advanceCareer(v);}}
      }
      else if(v.job==='scholar'&&sim.eduTier(v)>=3)sim.advanceCareer(v,true);
      else if(v.job==='idle'){
        if(sim.advanceCareer(v))continue;
        if(sim.eduTier(v)<3&&!(v.studyAfter>sim.s.time)){const b=sim.s.buildings.find(b=>b.type==='library'&&b.built&&!b.up&&b.sid===v.home&&b.workers.length<workersOf(b));if(b&&sim.assign(b,v)){v.lastStudy=sim.s.time;v.careerNote='Learning the next education tier';}}
      }
    }
  };
  const second=sim.second.bind(sim);sim.second=()=>{second();if((sim.careerT=(sim.careerT||0)+1)%20===0)sim.careerSecond();};
}
