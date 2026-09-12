import sys, numpy as np
from PIL import Image, ImageFilter, ImageDraw
from collections import deque
photo, screen, out, hx, hy = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4]), int(sys.argv[5])
im = Image.open(photo).convert('RGB'); W,H = im.size
a = np.asarray(im).astype(np.float32); lum=a.mean(axis=2); mx=a.max(axis=2); mn=a.min(axis=2)
def box(x, r):
    c = np.cumsum(np.cumsum(np.pad(x, ((r+1, r), (r+1, r)), mode='edge'), axis=0), axis=1)
    return (c[2*r+1:, 2*r+1:] - c[:-2*r-1, 2*r+1:] - c[2*r+1:, :-2*r-1] + c[:-2*r-1, :-2*r-1]) / float((2*r+1)**2)
r=5; m1=box(lum,r); m2=box(lum*lum,r); lstd=np.sqrt(np.maximum(m2-m1*m1,0))
mask = (lum > 140) & (lstd < 7.0) & ((mx-mn) < 110)
# closing to fill small fake-UI text gaps
mi = Image.fromarray((mask*255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13)).filter(ImageFilter.MinFilter(13))
mask = np.asarray(mi) > 127
s=4; ms=mask[::s,::s]; h,w=ms.shape
lab=np.zeros((h,w),dtype=np.int32); cur=0
hy_s, hx_s = hy//s, hx//s
# flood from the hint (search nearest mask pixel to hint)
ys,xs=np.nonzero(ms); d=(ys-hy_s)**2+(xs-hx_s)**2; i=d.argmin(); sy,sx=ys[i],xs[i]
q=deque([(sy,sx)]); lab[sy,sx]=1; pts=[]
while q:
    cy,cx=q.popleft(); pts.append((cy,cx))
    for ny,nx in ((cy-1,cx),(cy+1,cx),(cy,cx-1),(cy,cx+1)):
        if 0<=ny<h and 0<=nx<w and ms[ny,nx] and lab[ny,nx]==0: lab[ny,nx]=1; q.append((ny,nx))
comp = np.kron(lab==1, np.ones((s,s),dtype=bool))[:H,:W] & mask
ys,xs=np.nonzero(comp); print('component px', len(ys), 'bbox', xs.min(),ys.min(),xs.max(),ys.max())
# edge samples: per row leftmost/rightmost; per column topmost/bottommost
rows={}; cols={}
for y,x in zip(ys,xs):
    rows.setdefault(y,[x,x]); rows[y][0]=min(rows[y][0],x); rows[y][1]=max(rows[y][1],x)
    cols.setdefault(x,[y,y]); cols[x][0]=min(cols[x][0],y); cols[x][1]=max(cols[x][1],y)
def robust_fit(us, vs):
    # fit v = a*u + b, trimming outliers iteratively (keeps the OUTERMOST consistent line)
    us=np.array(us,float); vs=np.array(vs,float)
    keep=np.ones(len(us),bool)
    for _ in range(6):
        A=np.vstack([us[keep],np.ones(keep.sum())]).T; ab,_,_,_=np.linalg.lstsq(A,vs[keep],rcond=None)
        res=vs-(ab[0]*us+ab[1]); sd=max(res[keep].std(),1.0)
        keep=np.abs(res)<2.0*sd
    return ab
ry=sorted(rows); trim=int(len(ry)*0.08); ry=ry[trim:-trim]      # ignore rounded corners
L=robust_fit(ry,[rows[y][0] for y in ry]); R=robust_fit(ry,[rows[y][1] for y in ry])   # x = a*y+b
cx_=sorted(cols); trim=int(len(cx_)*0.08); cx_=cx_[trim:-trim]
T=robust_fit(cx_,[cols[x][0] for x in cx_]); B=robust_fit(cx_,[cols[x][1] for x in cx_])  # y = a*x+b
def isect(xl, yl):  # x = xl[0]*y+xl[1] ; y = yl[0]*x+yl[1]
    # x = a1*(a2*x+b2)+b1 -> x(1-a1*a2)=a1*b2+b1
    x=(xl[0]*yl[1]+xl[1])/(1-xl[0]*yl[0]); y=yl[0]*x+yl[1]; return (x,y)
tl=isect(L,T); tr=isect(R,T); br0=isect(R,B); bl0=isect(L,B)
import math
def unit(p,q):
    d=(q[0]-p[0],q[1]-p[1]); n=math.hypot(*d) or 1.0; return (d[0]/n,d[1]/n)
topw=math.hypot(tr[0]-tl[0],tr[1]-tl[1])
# expected side length from screen aspect (phone screens ~19.5:9)
exp=topw*2.16
dl=unit(tl,bl0); dr=unit(tr,br0)
# side directions: average the two fitted side directions to keep the screen a clean parallelogram
dx=(dl[0]+dr[0])/2; dy=(dl[1]+dr[1])/2; n=math.hypot(dx,dy) or 1.0; d=(dx/n,dy/n)
fitl=math.hypot(bl0[0]-tl[0],bl0[1]-tl[1]); fitr=math.hypot(br0[0]-tr[0],br0[1]-tr[1])
use = min(fitl,fitr)
if abs(use-exp)/exp>0.12: use=exp
bl=(tl[0]+d[0]*use, tl[1]+d[1]*use); br=(tr[0]+d[0]*use, tr[1]+d[1]*use)
print('topw',int(topw),'fitted sides',int(fitl),int(fitr),'expected',int(exp),'used',int(use))
quad=[tl,tr,br,bl]; print('quad', [(int(x),int(y)) for x,y in quad])
scr=Image.open(screen).convert('RGB'); sw,sh=scr.size
def coeffs(pa,pb):
    M=[]
    for p1,p2 in zip(pa,pb):
        M.append([p1[0],p1[1],1,0,0,0,-p2[0]*p1[0],-p2[0]*p1[1]]); M.append([0,0,0,p1[0],p1[1],1,-p2[1]*p1[0],-p2[1]*p1[1]])
    return np.linalg.solve(np.array(M,float), np.array(pb,float).reshape(8))
warped=scr.transform((W,H), Image.PERSPECTIVE, tuple(coeffs(quad,[(0,0),(sw,0),(sw,sh),(0,sh)])), Image.BICUBIC)
screen_lum=lum[comp].mean()/255.0
warped=Image.fromarray(np.clip(np.asarray(warped).astype(np.float32)*min(1.0,screen_lum/0.93),0,255).astype(np.uint8))
# alpha: quad polygon with rounded corners, minus occluders (non-bright, non-uniform pixels inside)
poly=Image.new('L',(W,H),0); ImageDraw.Draw(poly).polygon([(float(x),float(y)) for x,y in quad], fill=255)
poly=poly.filter(ImageFilter.MinFilter(7)).filter(ImageFilter.GaussianBlur(1.0))
occl = ~((lum > 120) & ((mx-mn) < 130))
occl_img = Image.fromarray((occl*255).astype(np.uint8)).filter(ImageFilter.MinFilter(9)).filter(ImageFilter.MaxFilter(15)).filter(ImageFilter.GaussianBlur(1.5))
alpha = Image.fromarray(np.clip(np.asarray(poly).astype(np.int32) - np.asarray(occl_img).astype(np.int32),0,255).astype(np.uint8))
Image.composite(warped, im, alpha).save(out, quality=95); print('saved', out)
