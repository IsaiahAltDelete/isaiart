# Faith and class buildings. Doors face -Y like the other exported assets.
import math, random

def cp_door(P,M,x,y,z=0,w=0.44,h=0.68):
    P.append(poly_extrude('arch',arch_pts(w+0.15,h+0.12,10),0.07,(x,y,z),M['cut'],bev=0.015))
    P.append(poly_extrude('leaf',arch_pts(w,h,10),0.08,(x,y-0.045,z+0.02),M['door']))
    P.append(box('split',(0.018,0.09,h*0.7),(x,y-0.065,z+0.02),M['trim']))
    P.append(sphere('handle',0.022,(x+0.08,y-0.10,z+0.34),M['gold'],sub=1))
    P.append(box('step',(w+0.28,0.25,0.07),(x,y-0.20,z),M['cut'],bev=0.02))

def cp_sun(P,M,x,y,z,r=0.15):
    P.append(cyl('sun',r,r,0.025,(x,y,z),M['gold'],seg=12,rot=(math.pi/2,0,0)))
    for k in range(8):
        a=k*math.pi/4;P.append(box('ray',(0.035,0.03,0.12),(x+math.sin(a)*r*1.35,y,z+math.cos(a)*r*1.35),M['gold'],rot=(0,a,0),bev=0.006))

def build_chapel():
    M=xslots();root=empty('chapel',(0,0,0));P=[pad('pad',M,1.9,1.9)];E=[]
    P.append(walls('nave',M,1.25,1.35,0.94,loc=(0,0.1,0),mat=M['stone']))
    P.append(gable_roof('roof',1.25,1.35,0.6,M,over=0.14,rows=5,loc=(0,0.1,0.94),rnd=random.Random(92)))
    cp_door(P,M,0,-0.59)
    for x in (-0.43,0.43):
        P.append(box('buttress',(0.13,0.20,0.92),(x,-0.56,0),M['cut'],bev=0.02))
        P.append(box('cap',(0.18,0.23,0.05),(x,-0.56,0.91),M['cut'],bev=0.012))
    P.append(cyl('roseframe',0.21,0.21,0.06,(0,-0.59,1.17),M['cut'],seg=12,rot=(math.pi/2,0,0)))
    P.append(cyl('roseglass',0.16,0.16,0.065,(0,-0.63,1.17),M['magic'],seg=12,rot=(math.pi/2,0,0)))
    for k in range(6):
        a=k*math.pi/3;P.append(beam('trace',(0,-0.68,1.17),(math.sin(a)*0.15,-0.68,1.17+math.cos(a)*0.15),0.015,0.015,M['gold']))
    P.append(box('tower',(0.42,0.42,0.60),(0,0.49,1.13),M['stone'],bev=0.025))
    for x in (-0.17,0.17):P.append(box('belfry',(0.07,0.38,0.35),(x,0.49,1.7),M['cut'],bev=0.01))
    P.append(box('lintel',(0.43,0.43,0.06),(0,0.49,2.03),M['cut'],bev=0.015))
    P.append(cyl('bell',0.05,0.12,0.17,(0,0.49,1.74),M['gold'],seg=10))
    P.append(cyl('spire',0.35,0.01,0.52,(0,0.49,2.09),material('slate',0x536279),seg=4,rot=(0,0,math.pi/4)))
    P.append(sphere('finial',0.045,(0,0.49,2.63),M['gold'],sub=1))
    for side in (-1,1):
        E+=window('side',M,(side*0.635,0.25,0.53),w=0.26,h=0.45,face='+X' if side==1 else '-X',shutters=False)
        P+=flower_bed('flowers',M,side*0.79,0.22,0.10,0.28,n=5,rnd=random.Random(94+side))
    return finish(root,P,E)

def build_temple():
    M=xslots();root=empty('temple',(0,0,0));P=[pad('pad',M,2.85,2.85)];E=[]
    P.append(box('platform',(2.15,2.1,0.16),(0,0.15,0),M['cut'],bev=0.04))
    P.append(walls('sanctuary',M,1.8,1.55,1.0,loc=(0,0.32,0.16),mat=M['white']))
    P.append(box('cornice',(1.94,1.69,0.11),(0,0.32,1.14),M['cut'],bev=0.03))
    P.append(cyl('drum',0.76,0.76,0.34,(0,0.32,1.22),M['stone'],seg=16,bev=0.025))
    for k in range(6):
        lo=math.cos(k*math.pi/12)*0.88;hi=math.cos((k+1)*math.pi/12)*0.88
        P.append(cyl('dome',lo,hi,0.115,(0,0.32,1.56+k*0.115),M['verd'],seg=16))
    P.append(cyl('spire',0.04,0.018,0.22,(0,0.32,2.26),M['gold'],seg=8));P.append(sphere('orb',0.09,(0,0.32,2.49),M['gold'],sub=1))
    cp_door(P,M,0,-0.50,0.16,w=0.52,h=0.82)
    for x in (-0.78,-0.38,0.38,0.78):
        P.append(box('colbase',(0.18,0.18,0.08),(x,-0.74,0.16),M['cut'],bev=0.02))
        P.append(cyl('column',0.060,0.070,0.98,(x,-0.74,0.24),M['white'],seg=10))
        P.append(box('capital',(0.17,0.17,0.08),(x,-0.74,1.20),M['cut'],bev=0.02))
    P.append(box('porchroof',(2.05,0.65,0.12),(0,-0.67,1.28),M['cut'],bev=0.025))
    P.append(poly_extrude('pediment',[(-1,0),(1,0),(0,0.4)],0.15,(0,-0.95,1.4),M['pale'],bev=0.01));cp_sun(P,M,0,-1.05,1.56,0.12)
    for n in range(3):P.append(box('stairs',(1.4+n*0.18,0.18,0.04*(3-n)),(0,-1.03-n*0.15,0),M['cut'],bev=0.015))
    for x in (-1.14,1.14):
        P.append(cyl('bowlbase',0.08,0.15,0.38,(x,-0.75,0),M['stone'],seg=8))
        P.append(cyl('bowl',0.20,0.25,0.12,(x,-0.75,0.38),M['gold'],seg=10))
        P.append(sphere('light',0.12,(x,-0.75,0.55),M['glow'],sub=1,scale=(0.7,0.7,1.6)));E.append(empty('pt_glow_lamp',(x,-0.75,0.55)))
    for side in (-1,1):E+=window('side',M,(side*0.91,0.3,0.65),w=0.35,h=0.5,face='+X' if side==1 else '-X',shutters=False)
    return finish(root,P,E)

def cp_target(P,M,x,y):
    for dx in (-0.13,0.13):P.append(box('targetleg',(0.05,0.08,0.62),(x+dx,y+0.08,0),M['wood'],rot=(0,dx,0)))
    for r,col,depth in ((0.28,'plank',0),(0.22,'white',-0.02),(0.14,'red',-0.04),(0.06,'gold',-0.06)):
        P.append(cyl('target',r,r,0.025,(x,y+depth,0.57),M[col],seg=16,rot=(math.pi/2,0,0)))

def build_trainingyard():
    M=xslots();root=empty('trainingyard',(0,0,0));P=[pad('pad',M,2.85,2.85)];E=[]
    P.append(box('sand',(2.50,2.45,0.04),(0,0,0),M['gravel'],bev=0.04))
    for x in (-1.2,1.2):
        for y in (-1.1,-0.4,0.4,1.1):P.append(box('post',(0.07,0.07,0.5),(x,y,0),M['wood'],bev=0.01))
        for z in (0.18,0.40):P.append(box('rail',(0.05,2.3,0.045),(x,0,z),M['plank']))
    for z in (0.18,0.4):P.append(box('backrail',(2.4,0.05,0.045),(0,1.15,z),M['plank']))
    for x in (-0.57,0.57):cp_target(P,M,x,0.62)
    for x in (-0.7,0.65):
        P.append(cyl('dummypost',0.045,0.055,0.95,(x,-0.35,0),M['wood'],seg=8))
        P.append(sphere('body',0.18,(x,-0.35,0.52),material('straw',0xd9bc70),sub=1,scale=(0.8,0.7,1.6)));P.append(sphere('head',0.10,(x,-0.35,0.90),material('straw',0xd9bc70),sub=1))
        P.append(box('arms',(0.50,0.04,0.05),(x,-0.35,0.64),M['wood'],rot=(0,0.15,0)))
        P.append(cyl('shield',0.14,0.14,0.04,(x-0.16,-0.43,0.63),M['red'],seg=10,rot=(math.pi/2,0,0)))
    for x in (-0.9,0.9):P.append(box('gate',(0.09,0.09,1.15),(x,-1.15,0),M['trim'],bev=0.02))
    P.append(box('lintel',(1.96,0.12,0.12),(0,-1.15,1.07),M['trim'],bev=0.02));P+=shield_sign('sign',M,(0,-1.21,0.96),0.35,col='red')
    P+=bunting('flags',M,(-1.1,1.13,0.9),(1.1,1.13,0.9),n=7,s=0.12)
    return finish(root,P,E)

def build_rangerlodge():
    M=xslots();M['roof']=material('roof',0x47795a);root=empty('rangerlodge',(0,0,0));P=[pad('pad',M,1.9,1.9)];E=[]
    P+=block('lodge',M,1.35,1.2,0.88,0.62,over=0.18,rows=5,y=0.21,rnd=random.Random(98))
    P.append(timber_frame('frame',M,1.35,1.2,0.88,braces=True));P[-1].location=(0,0.21,0)
    cp_door(P,M,-0.25,-0.41,w=0.35,h=0.63);E+=window('front',M,(0.43,-0.41,0.50),w=0.26,h=0.27,shutters=True)
    P+=shield_sign('badge',M,(0,-0.50,1.03),0.26,col='shutter');cp_target(P,M,0.68,-0.65)
    for k in range(3):P.append(cyl('logs',0.06,0.06,0.60,(-0.77,0.15+k*0.13,0.08),M['wood'],seg=8,rot=(0,math.pi/2,0)))
    P+=ptree('tree',M,-0.75,0.66,0.72);P+=barrel('barrel',M,(0.74,0.60,0),r=0.12,h=0.3)
    return finish(root,P,E)

def build_rogueguild():
    M=xslots();M['roof']=material('roof',0x56547b);root=empty('rogueguild',(0,0,0));P=[pad('pad',M,1.9,1.9)];E=[]
    P.append(walls('lower',M,1.4,1.2,0.7,loc=(0,0.20,0),mat=M['stone']));P.append(box('jetty',(1.55,1.32,0.08),(0,0.20,0.70),M['trim'],bev=0.02))
    P+=block('upper',M,1.48,1.28,0.65,0.58,z0=0.78,y=0.20,over=0.15,rows=5,rnd=random.Random(99))
    P.append(timber_frame('frame',M,1.48,1.28,0.65,z0=0.78,braces=True));P[-1].location=(0,0.20,0)
    cp_door(P,M,-0.30,-0.41,w=0.38,h=0.62)
    for x in (-0.4,0.4):E+=window('window',M,(x,-0.46,1.09),w=0.24,h=0.29,shutters=True)
    P.append(box('bracket',(0.44,0.055,0.05),(0.61,-0.54,0.96),M['metal']));P.append(box('lock',(0.24,0.065,0.20),(0.62,-0.57,0.67),M['gold'],bev=0.025))
    for x in (0.54,0.70):P.append(cyl('shackle',0.015,0.015,0.16,(x,-0.57,0.84),M['metal'],seg=6))
    P.append(box('shacklebar',(0.17,0.035,0.035),(0.62,-0.57,0.97),M['metal'],bev=0.012));P.append(sphere('keyhole',0.028,(0.62,-0.61,0.78),M['dark'],sub=1,scale=(0.7,0.3,1.3)))
    P+=barrel('barrel',M,(-0.73,0.65,0),r=0.13,h=0.30);P.append(box('bench',(0.55,0.20,0.06),(0.50,-0.70,0.23),M['plank'],bev=0.015))
    for x in (0.29,0.71):P.append(box('leg',(0.045,0.17,0.23),(x,-0.70,0),M['wood']))
    return finish(root,P,E)


