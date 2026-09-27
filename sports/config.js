const ZONES={ET:{name:"Eastern Time (ET)",tz:"America/New_York",abbr:"ET"},CT:{name:"Central Time (CT)",tz:"America/Chicago",abbr:"CT"},MT:{name:"Mountain Time (MT)",tz:"America/Denver",abbr:"MT"},PT:{name:"Pacific Time (PT)",tz:"America/Los_Angeles",abbr:"PT"}};
const LEAGUES=[
{id:"nfl",name:"NFL",color:"#6c6258",note:"Week 3 Sunday: 14 games, including Rio and Sunday Night Football"},
{id:"wnba",name:"WNBA Playoffs",color:"#8f5e52",note:"All four best-of-three first-round series open today"},
{id:"golf",name:"Presidents Cup",color:"#78805d",note:"International Team leads 10½–7½ entering 12 singles"},
{id:"nascar",name:"NASCAR",color:"#796f54",note:"Cup Series playoff race at Kansas Speedway"},
{id:"cycling",name:"UCI Road World Championships",color:"#66785f",note:"Elite men race for the rainbow jersey in Montréal"},
{id:"tennis",name:"Laver Cup",color:"#607d64",note:"Team Europe leads 7–5; Day 3 is in progress"},
{id:"mlb",name:"MLB",color:"#55758a",note:"Final-day division and Wild Card decisions"},
{id:"mls",name:"MLS",color:"#657b70",note:"Sunday Night Soccer on Apple TV"},
{id:"nwsl",name:"NWSL",color:"#6d7482",note:"Two national Sunday windows"},
{id:"ligamx",name:"Liga MX",color:"#786f57",note:"Three U.S.-broadcast Sunday matches"}];
const E=(league,start,a,b,watch,venue,coverage,why,blackout,flags=[],logos={})=>({league,start,a,b,watch,venue,coverage,why,blackout,flags,logos});
const EVENTS=[];
