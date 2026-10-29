from pathlib import Path
import json,re
p=Path('outputs/index.html');s=p.read_text(encoding='utf-8')
extra=[
 dict(name='Bell Carp',latin='Campana tacita',rarity='Uncommon',color=0x82b1a0,fin=0xca8e61,weight=[1.4,4.2],zone=0,desc='Its copper fins sway like a bell without a clapper. You hear a single note whenever it turns away.'),
 dict(name='Paper Skate',latin='Charta natans',rarity='Rare',color=0x9c9cac,fin=0x85869a,weight=[.5,1.8],zone=0,desc='Folded by something patient. The creases never soften, even in the rain. Please return it without reading the underside.'),
 dict(name='Glass Needle',latin='Acus lucens',rarity='Uncommon',color=0xafc9cc,fin=0x7089a7,weight=[.2,.9],zone=1,desc='A silver stitch in the dark water. It follows the gaps between lily leaves as though mending something underneath.'),
 dict(name='Candlefin',latin='Vigilia rubra',rarity='Rare',color=0xa9656e,fin=0xcf947a,weight=[.8,2.6],zone=1,desc='Seven warm lights along each flank. None goes out when it dives. Someone is keeping a vigil among the roots.'),
 dict(name='Ribbon Sleeper',latin='Somnium longum',rarity='Rare',color=0x799f92,fin=0xa1b69d,weight=[1.1,3.7],zone=2,desc='A long, quiet dream with fins. It scarcely opens its eyes. When it does, the pond seems to remember another sky.'),
 dict(name='Reed Crown',latin='Coronatus palustris',rarity='Legendary',color=0x98a37c,fin=0xa88c61,weight=[2.4,6.5],zone=2,desc='The reeds bow when it passes. Its little crown is older than the dock, and considerably less interested in visitors.')
]
newbeh=[
 dict(name='SWAYING',period=6.8,start=3.5,duration=1.2,pull=.19,surge=.22,speed=.13),
 dict(name='GLIDING',period=5.9,start=3.0,duration=1.45,pull=.17,surge=.20,speed=.135),
 dict(name='FLICKERING',period=3.7,start=1.9,duration=.55,pull=.18,surge=.29,speed=.145),
 dict(name='PULSING',period=5.2,start=2.7,duration=.9,pull=.20,surge=.26,speed=.135),
 dict(name='DRIFTING',period=7.3,start=3.8,duration=1.7,pull=.19,surge=.23,speed=.125),
 dict(name='REGAL',period=5.8,start=2.9,duration=1.35,pull=.24,surge=.30,speed=.125)]
newnotes=[
 'A pressed copper leaf. “The bell was never in the tower. We only built it a place to listen.”',
 'This page folds itself into a boat. The handwriting is on the inside.',
 'Silver thread binds a torn letter. “Some things can be mended without being explained.”',
 'Seven pinholes glow through the paper. “We kept the lights for you. We always do.”',
 'A ribbon marks a passage you do not remember writing. “Rest. The shore will still be here.”',
 'A reed laid across the final page. “Nothing here was lost. There is room for you, too.”']
def append_array(name,values):
 global s
 pattern=r'const '+name+r'=\[.*?\n\];'
 m=re.search(pattern,s,re.S)
 assert m,name
 s=s[:m.start()]+m.group()[:-3].rstrip()+',\n '+',\n '.join(json.dumps(v,ensure_ascii=False) for v in values)+'\n];'+s[m.end():]
if '"Bell Carp"' not in re.search(r'const fishData=\[.*?\n\];',s,re.S).group():
 append_array('fishData',extra);append_array('fishBehaviors',newbeh);append_array('memories',newnotes)
 old=re.search(r"const runNames=\[.*?\];",s).group()
 s=s.replace(old,old[:-2]+','+','.join(json.dumps(x) for x in ['Slow pendulum pulls','Long gliding sweeps','Quick silver flicks','Warm, rhythmic pulses','Unhurried drifting turns','Patient, powerful turns'])+'];')
s=s.replace('for(let i=0;i<6;i++){const f=s.fish[i]','for(let i=0;i<fishData.length;i++){const f=s.fish[i]')
s=s.replace('for(let i=0;i<6;i++){viewScene.add(fishModels[i])','for(let i=0;i<fishModels.length;i++){viewScene.add(fishModels[i])')
s=s.replace('${n} / 6','${n} / ${fishData.length}').replace('${n} of 6 species','${n} of ${fishData.length} species')
s=s.replace('${found}/6 pages','${found}/${fishData.length} pages').replace('found===6','found===fishData.length')
s=s.replace("PAGE 0${i+1}","PAGE ${String(i+1).padStart(2,'0')}")
s=s.replace("Find the ${i%2?'second':'first'} resident of ${spotNames[Math.floor(i/2)]}.","Find another resident of ${spotNames[fishData[i].zone]}.")
s=s.replace("['Near the old dock','Near the old dock','Among the lilies','Among the lilies','In deeper water','In deeper water'][i]","['Near the old dock','Among the lilies','In deeper water'][f.zone]")
s=s.replace("['the old dock','the old dock','lily beds','lily beds','deep water','deep water'][id]","['the old dock','lily beds','deep water'][d.zone]")
s=s.replace('Six residents. All returned a little damp.','Twelve residents. All returned a little damp.')
s=s.replace('The last page is blank until it dries.','One page is blank until it dries.')
start=s.index('function chooseFish(){');end=s.index('\nfunction act()',start)
s=s[:start]+"""function chooseFish(){
 if(save.total===0&&zone===0){currentFish=0;return}
 const residents=fishData.map((f,i)=>({f,i})).filter(x=>x.f.zone===zone).map(x=>x.i);
 const unseen=residents.filter(i=>!save.fish[i]);
 const pool=unseen.length&&Math.random()<(castAccuracy>.61?.88:.70)?unseen:residents;
 currentFish=pool[Math.min(pool.length-1,Math.floor(Math.random()*pool.length))];
}"""+s[end:]
s=s.replace("get version(){return '4.6.0'}","get version(){return '4.9.0'}").replace('v4.8.0','v4.9.0')
p.write_text(s,encoding='utf-8')
