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

def build_manor():
    M=xslots();M['roof']=material('roof',0x536d88);root=empty('manor',(0,0,0));P=[pad('pad',M,2.9,2.9)];E=[]
    P.append(box('foundation',(2.32,1.67,0.20),(0,0.26,0),M['cut'],bev=0.04))
    P.append(walls('hall',M,2.18,1.52,1.48,loc=(0,0.26,0.2),mat=M['white']))
    P.append(gable_roof('roof',2.18,1.52,0.82,M,over=0.15,rows=6,loc=(0,0.26,1.68),rnd=random.Random(116)))
    for x in (-1.04,1.04):
        P.append(box('pillar',(0.15,1.58,1.51),(x,0.26,0.20),M['cut'],bev=0.02))
        P.append(box('chimney',(0.22,0.26,0.63),(x*0.7,0.54,1.91),M['stone'],bev=0.02))
    for z in (0.22,1.0,1.62):P.append(box('belt',(2.25,1.58,0.055),(0,0.26,z),M['cut'],bev=0.012))
    cp_door(P,M,0,-0.52,0.20,w=0.55,h=0.79)
    housing_windows(E,M,[-0.74,0.74],-0.52,0.62,w=0.37,h=0.48)
    housing_windows(E,M,[-0.74,0,0.74],-0.52,1.28,w=0.32,h=0.40)
    for x in (-0.46,0.46):P.append(cyl('porchcol',0.055,0.065,0.94,(x,-0.93,0.2),M['cut'],seg=8))
    P.append(box('portico',(1.13,0.71,0.09),(0,-0.74,1.16),M['cut'],bev=0.02))
    P.append(poly_extrude('crest',[(-0.13,0.16),(0.13,0.16),(0.13,0),(0,-0.10),(-0.13,0)],0.04,(0,-1.12,1.19),M['gold'],bev=0.012))
    for i in range(3):P.append(box('step',(1.11+0.12*i,0.18,0.07*(3-i)),(0,-1.03-i*0.14,0),M['cut'],bev=0.012))
    for x in (-1.12,1.12):
        P.append(box('planter',(0.34,0.42,0.23),(x,-0.87,0),M['stone'],bev=0.03))
        P+=flower_bed('garden',M,x,-0.87,0.24,0.28,n=5,rnd=random.Random(117+int(x)))
    return finish(root,P,E)
