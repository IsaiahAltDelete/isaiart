# Additional family homes and communal lodging. Front doors face -Y.
import math, random

def housing_windows(E,M,xs,y,z,w=0.28,h=0.36):
    for x in xs:E+=window('window',M,(x,y,z),w=w,h=h,shutters=True)

def build_rowhouse():
    M=xslots();root=empty('rowhouse',(0,0,0));P=[pad('pad',M,2.9,1.9)];E=[]
    for i,x in enumerate((-0.63,0.63)):
        N=dict(M);N['roof']=material('roof',0xa45740 if i==0 else 0x547b89)
        N['wall']=material('plaster',0xe2cb9a if i==0 else 0xb9d1ca)
        P.append(walls('home',N,1.15,1.28,1.42,loc=(x,0.17,0),mat=N['wall']))
        P.append(gable_roof('roof',1.15,1.28,0.58,N,over=0.12,rows=5,loc=(x,0.17,1.42),rnd=random.Random(110+i)))
        frame=timber_frame('frame',N,1.15,1.28,1.42,braces=True);frame.location=(x,0.17,0);P.append(frame)
        cp_door(P,N,x-0.24,-0.48,w=0.32,h=0.64)
        housing_windows(E,N,[x+0.25],-0.48,0.46,w=0.25,h=0.28)
        housing_windows(E,N,[x-0.26,x+0.26],-0.48,1.02,w=0.25,h=0.32)
        P.append(box('windowbox',(0.72,0.14,0.13),(x,-0.56,0.89),N['wood'],bev=0.012))
        P+=flower_bed('flowers',N,x,-0.56,0.95,0.34,n=4,rnd=random.Random(112+i))
        P.append(box('chimney',(0.16,0.19,0.45),(x+0.33,0.47,1.60),N['stone'],bev=0.015))
    return finish(root,P,E)

def build_hostel():
    M=xslots();M['roof']=material('roof',0x63774d);root=empty('hostel',(0,0,0));P=[pad('pad',M,2.9,1.9)];E=[]
    P.append(walls('lower',M,2.40,1.22,0.79,loc=(0,0.20,0),mat=M['stone']))
    P+=block('upper',M,2.5,1.30,0.68,0.58,y=0.20,z0=0.79,over=0.12,rows=5,rnd=random.Random(114))
    frame=timber_frame('frame',M,2.50,1.30,0.68,z0=0.79,braces=True);frame.location=(0,0.20,0);P.append(frame)
    cp_door(P,M,0,-0.43,w=0.44,h=0.67)
    housing_windows(E,M,[-0.91,-0.44,0.44,0.91],-0.46,1.10,w=0.25,h=0.32)
    housing_windows(E,M,[-0.86,0.86],-0.43,0.46,w=0.28,h=0.30)
    for x in (-0.49,0.49):P.append(box('post',(0.055,0.055,0.88),(x,-0.78,0),M['wood'],bev=0.01))
    P.append(box('porchroof',(1.16,0.60,0.09),(0,-0.68,0.91),M['roof'],rot=(0.1,0,0),bev=0.02))
    P+=bunting('welcome',M,(-1.14,-0.55,1.02),(1.14,-0.55,1.02),n=7,s=0.11)
    P.append(box('sign',(0.39,0.055,0.25),(0.86,-0.55,0.89),M['wood'],bev=0.025))
    P.append(box('bed',(0.28,0.02,0.07),(0.86,-0.59,0.99),M['white'],bev=0.01))
    for x in (0.74,0.98):P.append(box('bedleg',(0.025,0.025,0.06),(x,-0.59,0.94),M['white']))
    P.append(box('bench',(0.66,0.22,0.07),(-0.90,-0.70,0.23),M['plank'],bev=0.02))
    for x in (-1.15,-0.66):P.append(box('leg',(0.055,0.15,0.23),(x,-0.70,0),M['wood']))
    P+=barrel('barrel',M,(1.15,-0.67,0),r=0.12,h=0.30)
    return finish(root,P,E)

def quoins(P,M,x,y,z0,z1,step=0.15):
    """Alternating dressed corner stones up a wall corner."""
    k=0;z=z0
    while z<z1-0.05:
        w=0.16 if k%2==0 else 0.11
        P.append(box('quoin',(0.06+w*0.5,0.06+w*0.5,step-0.02),(x,y,z),M['cut'],bev=0.012));z+=step;k+=1

def topiary(P,M,x,y):
    P.append(box('tpot',(0.24,0.24,0.18),(x,y,0),M['cut'],bev=0.03))
    P.append(box('tpotrim',(0.28,0.28,0.04),(x,y,0.17),M['cut'],bev=0.012))
    P.append(cyl('tstem',0.025,0.03,0.3,(x,y,0.2),M['bark'],seg=6))
    P.append(uvsphere('tball',0.16,(x,y,0.42),M['leafs'],seg=14,rings=9))
    P.append(uvsphere('tball2',0.09,(x,y,0.64),M['leafs2'],seg=12,rings=7))

def build_manor():
    # The grandest home: a two-storey Georgian front with a gabled centre pavilion,
    # a columned portico carrying a balcony, dormers, twin chimneys, flower boxes,
    # and a hedged front garden with a gate and clipped topiaries.
    M=xslots();rnd=random.Random(116)
    M['roof']=material('roof',0x536d88);M['trim']=material('trim',0xf1ebdf)
    PL=material('plaster',0xf3e4c6)
    root=empty('manor',(0,0,0));P=[pad('pad',M,2.9,2.9)];E=[]
    W,D,cy,G=2.3,1.3,0.36,0.2;H=1.48;RH=0.7;fy=cy-D/2
    PW,PF=0.96,-0.58;pcy=(PF+cy)/2;PD=cy-PF
    # front garden: lawn, a gravel walk, an L of clipped hedge and a gate
    P.append(box('lawn',(2.78,1.0,0.03),(0,-0.9,0.025),material('grass',0x86c25a),bev=0.012))
    P.append(box('walk',(0.52,0.36,0.035),(0,-1.24,0.03),M['gravel'],bev=0.012))
    for s_ in (-1,1):
        P.append(box('hedge',(1.0,0.16,0.22),(s_*0.89,-1.33,0.02),M['leafs'],bev=0.06,segs=2))
        P.append(box('hedgeside',(0.16,0.85,0.22),(s_*1.33,-0.83,0.02),M['leafs'],bev=0.06,segs=2))
        P.append(box('gatepost',(0.14,0.14,0.42),(s_*0.33,-1.33,0.02),M['cut'],bev=0.015))
        P.append(box('gatecap',(0.18,0.18,0.04),(s_*0.33,-1.33,0.44),M['cut'],bev=0.01))
        P.append(uvsphere('gateball',0.055,(s_*0.33,-1.33,0.53),M['cut'],seg=10,rings=6))
        for k in range(4):
            x=s_*(0.07+k*0.055);hb=0.3+0.05*math.cos((k+0.5)/4*math.pi/2)
            P.append(cyl('gatebar',0.011,0.011,hb,(x,-1.33,0.03),M['metal'],seg=6))
            P.append(cyl('gatetip',0.022,0.0,0.05,(x,-1.33,0.03+hb),M['gold'],seg=6))
        P.append(box('gaterail',(0.24,0.02,0.025),(s_*0.145,-1.33,0.1),M['metal']))
        P.append(box('gaterail2',(0.24,0.02,0.025),(s_*0.145,-1.33,0.27),M['metal']))
    # foundations, the main block and the centre pavilion
    P.append(box('foundation',(W+0.14,D+0.14,G),(0,cy,0),M['cut'],bev=0.03))
    P.append(box('pfound',(PW+0.14,0.4,G),(0,PF+0.13,0),M['cut'],bev=0.03))
    P+=block('hall',M,W,D,H,RH,over=0.15,rows=6,z0=G,y=cy,wall_mat=PL,rnd=rnd)
    P+=block('pav',M,PW,PD,H,0.5,front_gable=True,over=0.08,z0=G,y=pcy,wall_mat=PL,rnd=random.Random(117))
    for z,hh in ((G+0.76,0.06),(G+H-0.03,0.08)):
        P.append(box('belt',(W+0.05,D+0.05,hh),(0,cy,z),M['cut'],bev=0.012))
        P.append(box('pbelt',(PW+0.05,PD+0.05,hh),(0,pcy,z),M['cut'],bev=0.012))
    for x in (-W/2,W/2):quoins(P,M,x,fy,G,G+H)
    for x in (-PW/2,PW/2):quoins(P,M,x,PF,G,G+H)
    # the oculus in the pavilion gable
    oz=G+H+0.2
    P.append(cyl('oculusfr',0.13,0.13,0.05,(0,PF-0.005,oz),M['cut'],seg=16,rot=(math.pi/2,0,0)))
    P.append(cyl('oculus',0.095,0.095,0.06,(0,PF-0.01,oz),M['win'],seg=16,rot=(math.pi/2,0,0)))
    for a in (0,math.pi/2):P.append(box('oculusbar',(0.19,0.07,0.018),(0,PF-0.012,oz),M['trim'],base=False,rot=(0,a,0)))
    E.append(empty('pt_glow_win',(0,PF-0.05,oz)))
    # windows: shuttered below, flower boxes above, a tall French window over the door
    for x in (-0.79,0.79):
        E+=window('gw',M,(x,fy-0.005,G+0.22),w=0.32,h=0.42,shutters=True)
        E+=window('uw',M,(x,fy-0.005,G+0.92),w=0.3,h=0.38,shutters=True,box_flowers=True)
    E+=window('fw',M,(0,PF-0.005,G+0.92),w=0.3,h=0.42,shutters=False)
    for sx in (-1,1):
        for z in (G+0.22,G+0.92):E+=window('sw',M,(sx*(W/2+0.005),cy,z),w=0.28,h=0.36,face='+X' if sx==1 else '-X',shutters=True)
    # the portico: a landing, four columns, an entablature with the family crest and a balcony
    P.append(box('landing',(1.16,0.46,G),(0,PF-0.22,0),M['cut'],bev=0.02))
    for k in range(3):P.append(box('step',(1.0+0.1*k,0.13,G*(3-k)/3-0.005),(0,PF-0.5-k*0.12,0),M['cut'],bev=0.012))
    cp_door(P,M,0,PF-0.005,G,w=0.42,h=0.64)
    PY=PF-0.36
    for x in (-0.47,-0.25,0.25,0.47):
        P.append(box('colbase',(0.13,0.13,0.05),(x,PY,G),M['cut'],bev=0.012))
        P.append(cyl('column',0.048,0.056,0.66,(x,PY,G+0.04),M['white'],seg=12,bev=0.008))
        P.append(box('capital',(0.13,0.13,0.05),(x,PY,G+0.69),M['cut'],bev=0.012))
    ez=G+0.74
    P.append(box('entablature',(1.18,0.48,0.1),(0,PF-0.2,ez),M['cut'],bev=0.02))
    P.append(poly_extrude('crest',[(-0.12,0.15),(0.12,0.15),(0.12,0),(0,-0.09),(-0.12,0)],0.04,(0,PF-0.45,ez+0.03),M['gold'],bev=0.012))
    bz=ez+0.1
    for k in range(11):
        x=-0.52+k*0.104;P.append(cyl('baluster',0.018,0.024,0.13,(x,PF-0.42,bz),M['white'],seg=6))
    for sx in (-1,1):
        for k in range(3):P.append(cyl('baluster',0.018,0.024,0.13,(sx*0.55,PF-0.1-k*0.1,bz),M['white'],seg=6))
        P.append(box('siderail',(0.05,0.4,0.035),(sx*0.55,PF-0.22,bz+0.13),M['cut'],bev=0.008))
    P.append(box('rail',(1.14,0.05,0.035),(0,PF-0.42,bz+0.13),M['cut'],bev=0.008))
    for x in (-0.33,0.33):
        P+=[box('lamp',(0.08,0.08,0.11),(x,PF-0.06,G+0.46),M['glow'],bev=0.015),
            cyl('lampcap',0.07,0.015,0.05,(x,PF-0.06,G+0.57),M['metal'],seg=4,rot=(0,0,math.pi/4)),
            box('lampbr',(0.02,0.06,0.02),(x,PF-0.03,G+0.52),M['metal'])]
        E.append(empty('pt_glow_lamp',(x,PF-0.07,G+0.51)))
    # dormers on the front slope, twin chimneys on the gable ends
    half=D/2+0.15
    for x in (-0.8,0.8):
        dy0=0.44;zr=G+H+RH*(1-dy0/half)
        P.append(box('dormer',(0.36,0.42,0.3),(x,cy-dy0+0.21,zr-0.12),PL,bev=0.015))
        g2=gable_fill('dgable',M,0.42,0.36,0.15,0,mat=PL);g2.location=(x,cy-dy0+0.21,zr+0.18);g2.rotation_euler=(0,0,math.pi/2);P.append(g2)
        P.append(gable_roof('droof',0.46,0.36,0.17,M,over=0.05,thick=0.05,sag=0,loc=(x,cy-dy0+0.19,zr+0.18),rot_z=math.pi/2,snow=False))
        E+=window('dw',M,(x,cy-dy0-0.005,zr-0.06),w=0.17,h=0.17,shutters=False)
    for x in (-0.98,0.98):E+=chimney('chim',M,(x,cy+0.12,G+H+0.25),h=0.92,lean=0.0,rnd=random.Random(118+int(x*10)))
    # the garden: topiaries by the steps, flower beds under the windows
    for x in (-0.8,0.8):
        topiary(P,M,x,-1.0)
        P+=flower_bed('bed',M,x,fy-0.17,0.36,0.1,n=6,rnd=random.Random(119+int(x*10)),edge=False)
    return finish(root,P,E)
