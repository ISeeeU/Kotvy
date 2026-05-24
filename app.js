"use strict";
(function(){
  /* ====================================================================
     DÁTOVÝ MODEL
     Stena je parametrická lomenina:
       wall.origin   = {x,y}  počiatočný bod
       wall.startDir = uhol prvého segmentu (rad)
       wall.segs     = [{len, lenLock, ang, angLock}]
         len      = dĺžka segmentu (m)
         ang      = vnútorný uhol lomu na ZAČIATKU segmentu (°), pre seg[0] neplatí
         *Lock    = či je parameter zamknutý
     Vrcholy sa dopočítajú funkciou vertices().
     ==================================================================== */
  // Wall starts empty, first click sets origin
  var wall={origin:null, startDir:0, segs:[]};
  var anchors=[];
  var mode='wall', selected=-1, selWall=false, sel=null; // sel = {kind:'len'|'ang', idx}
  var view={ox:60,oy:60,scale:22};
  var isoView={rot:0.7,scale:13};
  var history=[];

  var planC=document.getElementById('plan'), pc=planC.getContext('2d');
  var isoC=document.getElementById('iso'),  ic=isoC.getContext('2d');
  var editBox=document.getElementById('editBox');

  /* ---------- história ---------- */
  function snapshot(){
    history.push(JSON.stringify({wall:wall,anchors:anchors}));
    if(history.length>40) history.shift();
  }
  function undo(){
    if(!history.length) return;
    var s=JSON.parse(history.pop());
    wall=s.wall; anchors=s.anchors; selected=-1; selWall=false; sel=null;
    syncPanels(); redraw();
  }

  /* ---------- parametrická stena → vrcholy ---------- */
  function vertices(){
    if (!wall.origin) return [];
    var pts=[{x:wall.origin.x,y:wall.origin.y}];
    var dir=wall.startDir;
    for(var i=0;i<wall.segs.length;i++){
      if(i>0){
        // vnútorný uhol -> zmena smeru. turn = 180 - innerAngle, znamienko podľa segs[i].angSign
        var sign=wall.segs[i].angSign||1;
        dir+=(180-wall.segs[i].ang)*Math.PI/180*sign;
      }
      var last=pts[pts.length-1];
      pts.push({x:last.x+Math.cos(dir)*wall.segs[i].len,
                y:last.y+Math.sin(dir)*wall.segs[i].len});
    }
    return pts;
  }
  function nSeg(){return wall.segs.length;}
  function segVecV(verts,i){
    var L=Math.hypot(verts[i+1].x-verts[i].x,verts[i+1].y-verts[i].y)||1;
    return {x:(verts[i+1].x-verts[i].x)/L,y:(verts[i+1].y-verts[i].y)/L};
  }
  function segNormalV(verts,i){var v=segVecV(verts,i);return {x:v.y,y:-v.x};}

  /* prepočet parametrov z vrcholov (po ťahaní vrcholu) */
  function rebuildFromVertices(pts){
    if(pts.length<1){ wall.segs=[]; wall.origin=null; return; }
    if(pts.length===1){ wall.segs=[]; wall.origin={x:pts[0].x, y:pts[0].y}; return; }
    wall.origin={x:pts[0].x,y:pts[0].y};
    var dir0=Math.atan2(pts[1].y-pts[0].y,pts[1].x-pts[0].x);
    wall.startDir=dir0;
    var newSegs=[];
    for(var i=0;i<pts.length-1;i++){
      var L=Math.hypot(pts[i+1].x-pts[i].x,pts[i+1].y-pts[i].y);
      var prev=wall.segs[i]||{};
      var seg={len:L, lenLock:prev.lenLock||false,
               ang:180, angLock:prev.angLock||false, angSign:1};
      if(i>0){
        var v1={x:pts[i].x-pts[i-1].x,y:pts[i].y-pts[i-1].y};
        var v2={x:pts[i+1].x-pts[i].x,y:pts[i+1].y-pts[i].y};
        var a=Math.atan2(v2.y,v2.x)-Math.atan2(v1.y,v1.x);
        var deg=Math.abs(180-Math.abs(a*180/Math.PI));
        var cross=v1.x*v2.y-v1.y*v2.x;
        seg.ang=deg; seg.angSign=cross>=0?1:-1;
      }
      newSegs.push(seg);
    }
    wall.segs=newSegs;
  }

  /* ---------- geometria pomocná ---------- */
  function segLenV(verts,i){return Math.hypot(verts[i+1].x-verts[i].x,verts[i+1].y-verts[i].y);}
  function wallPointAtV(verts,t){
    var idx=Math.min(Math.max(0,Math.floor(t)),verts.length-2),f=t-idx;
    var p=verts[idx],q=verts[idx+1];
    return {x:p.x+(q.x-p.x)*f,y:p.y+(q.y-p.y)*f};
  }
  function wallSegIndex(t){return Math.min(Math.max(0,Math.floor(t)),nSeg()-1);}
  function totalWallLen(){var s=0;for(var i=0;i<wall.segs.length;i++)s+=wall.segs[i].len;return s;}
  function devLengthV(t){
    var idx=wallSegIndex(t),s=0;
    for(var i=0;i<idx;i++)s+=wall.segs[i].len;
    return s+(t-idx)*wall.segs[idx].len;
  }
  function innerAngle(i){return wall.segs[i]?wall.segs[i].ang:180;}

  /* ---------- geometria kotvy ---------- */
  function anchorDiameters(a){
    var freeDia=(a.freeDia!=null?a.freeDia:(a.dia!=null?a.dia:150));
    var bondDia=(a.bondDia!=null?a.bondDia:freeDia);
    return {freeDia:freeDia,bondDia:bondDia};
  }
  function anchorGeom(a){
    var verts=vertices();
    var i=wallSegIndex(a.t), n=segNormalV(verts,i), s=a.side||1;
    var nx=n.x*s, ny=n.y*s;
    var sk=(a.skew||0)*Math.PI/180;
    var dx=nx*Math.cos(sk)-ny*Math.sin(sk);
    var dy=nx*Math.sin(sk)+ny*Math.cos(sk);
    var inc=(a.incline||0)*Math.PI/180, hor=Math.cos(inc);
    var vx=dx*hor, vy=dy*hor, vz=-Math.sin(inc);
    var wp=wallPointAtV(verts,a.t);
    var dims=anchorDiameters(a);
    var head=[wp.x,wp.y,a.z];
    var freeEnd=[wp.x+vx*a.free,wp.y+vy*a.free,a.z+vz*a.free];
    var bondEnd=[freeEnd[0]+vx*a.bond,freeEnd[1]+vy*a.bond,freeEnd[2]+vz*a.bond];
    return {head:head,freeEnd:freeEnd,bondEnd:bondEnd,
            freeR:dims.freeDia/2000,bondR:dims.bondDia/2000};
  }

  /* ---------- vzdialenosť úsečiek ---------- */
  function v3(a,b){return [a[0]-b[0],a[1]-b[1],a[2]-b[2]];}
  function add3(a,b){return [a[0]+b[0],a[1]+b[1],a[2]+b[2]];}
  function sc3(a,s){return [a[0]*s,a[1]*s,a[2]*s];}
  function dot3(a,b){return a[0]*b[0]+a[1]*b[1]+a[2]*b[2];}
  function len3(a){return Math.hypot(a[0],a[1],a[2]);}
  function cl01(v){return v<0?0:v>1?1:v;}
  function segSegDist(p1,p2,q1,q2){
    var d1=v3(p2,p1),d2=v3(q2,q1),r=v3(p1,q1);
    var a=dot3(d1,d1),e=dot3(d2,d2),f=dot3(d2,r),s,t;
    if(a<1e-9&&e<1e-9)return {d:len3(r),pa:p1,pb:q1};
    if(a<1e-9){s=0;t=cl01(f/e);}
    else{var c=dot3(d1,r);
      if(e<1e-9){t=0;s=cl01(-c/a);}
      else{var b=dot3(d1,d2),den=a*e-b*b;
        s=den>1e-9?cl01((b*f-c*e)/den):0;
        t=(b*s+f)/e;
        if(t<0){t=0;s=cl01(-c/a);}else if(t>1){t=1;s=cl01((b-c)/a);}}}
    var pa=add3(p1,sc3(d1,s)),pb=add3(q1,sc3(d2,t));
    return {d:len3(v3(pa,pb)),pa:pa,pb:pb};
  }

  /* ---------- kolízie ---------- */
  function collisions(){
    var limB=parseFloat(document.getElementById('limBond').value)||1.5;
    var limF=parseFloat(document.getElementById('limFree').value)||0.5;
    var res=[],G=anchors.map(anchorGeom);
    for(var i=0;i<anchors.length;i++)for(var j=i+1;j<anchors.length;j++){
      var gi=G[i],gj=G[j];
      var parts=[
        ['voľná','voľná',gi.head,gi.freeEnd,gj.head,gj.freeEnd,gi.freeR+gj.freeR],
        ['voľná','koreň',gi.head,gi.freeEnd,gj.freeEnd,gj.bondEnd,gi.freeR+gj.bondR],
        ['koreň','voľná',gi.freeEnd,gi.bondEnd,gj.head,gj.freeEnd,gi.bondR+gj.freeR],
        ['koreň','koreň',gi.freeEnd,gi.bondEnd,gj.freeEnd,gj.bondEnd,gi.bondR+gj.bondR]];
      var best=null;
      for(var k=0;k<parts.length;k++){
        var p=parts[k],rr=segSegDist(p[2],p[3],p[4],p[5]);
        var clear=rr.d-p[6];
        var isBond=(p[0]==='koreň'&&p[1]==='koreň');
        var lim=isBond?limB:limF,sev=clear-lim;
        if(best===null||sev<best.sev)
          best={i:i,j:j,kind:p[0]+'–'+p[1],clear:clear,axis:rr.d,lim:lim,sev:sev,pa:rr.pa,pb:rr.pb};
      }
      res.push(best);
    }
    res.sort(function(a,b){return a.clear-b.clear;});
    return res;
  }

  /* ====================================================================
     ZÁMKY — prepis parametra s rešpektovaním zámkov
     Pri zmene dĺžky/uhla sa parameter nastaví. Zamknuté parametre sa
     nikdy nemenia samé. Keďže stena je parametrická reťaz, zmena
     ľubovoľného segmentu len posúva nasledujúce vrcholy — zamknuté
     parametry tým ostávajú nedotknuté automaticky.
     Pri ŤAHANÍ vrcholu sa naopak zamknuté parametre musia zachovať:
     zamknutú dĺžku/uhol po ťahaní vrátime na pôvodnú hodnotu.
     ==================================================================== */
  function setSegLen(i,newL){
    if(newL<=0.05||!wall.segs[i])return;
    wall.segs[i].len=newL;
  }
  function setSegAngle(i,newDeg){
    if(!wall.segs[i]||i===0)return;
    wall.segs[i].ang=newDeg;
  }
  function toggleLock(kind,idx){
    if(kind==='len') wall.segs[idx].lenLock=!wall.segs[idx].lenLock;
    else if(kind==='ang') wall.segs[idx].angLock=!wall.segs[idx].angLock;
  }
  function rebuildRespectingLocks(pts){
    var saved=wall.segs.map(function(s){return {len:s.len,lenLock:s.lenLock,
                                                ang:s.ang,angLock:s.angLock,angSign:s.angSign};});
    rebuildFromVertices(pts);
    for(var i=0;i<wall.segs.length;i++){
      if(saved[i]&&saved[i].lenLock){wall.segs[i].len=saved[i].len; wall.segs[i].lenLock=true;}
      if(saved[i]&&saved[i].angLock){wall.segs[i].ang=saved[i].ang;
        wall.segs[i].angSign=saved[i].angSign; wall.segs[i].angLock=true;}
    }
  }

  function toScreen(x,y){return [view.ox+x*view.scale,view.oy+y*view.scale];}
  function toModel(sx,sy){return [(sx-view.ox)/view.scale,(sy-view.oy)/view.scale];}

  var hits=[];
  function dimText(cx,cy,txt,col,type,ref,locked){
    pc.font='11px Segoe UI';
    var lockW=locked?13:0;
    var tw=pc.measureText(txt).width+lockW;
    pc.fillStyle='#1b1e18';
    pc.fillRect(cx-tw/2-3,cy-8,tw+6,16);
    pc.fillStyle=col; pc.textAlign='left'; pc.textBaseline='middle';
    pc.fillText(txt,cx-tw/2,cy);
    if(locked){
      var lx=cx+tw/2-9;
      pc.strokeStyle='var(--lock)'; pc.fillStyle='#e0a83b';
      pc.fillRect(lx,cy-2,7,6);
      pc.strokeStyle='#e0a83b'; pc.lineWidth=1.3;
      pc.beginPath(); pc.arc(lx+3.5,cy-2,2.6,Math.PI,0); pc.stroke();
    }
    pc.textAlign='left'; pc.textBaseline='alphabetic';
    if(type) hits.push({x:cx-tw/2-3,y:cy-8,w:tw+6,h:16,type:type,ref:ref});
  }
  function dimArrows(x1,y1,x2,y2,col,bold){
    pc.strokeStyle=col; pc.lineWidth=bold?2.4:1;
    pc.beginPath();pc.moveTo(x1,y1);pc.lineTo(x2,y2);pc.stroke();
    var a=Math.atan2(y2-y1,x2-x1);
    [[x1,y1,a],[x2,y2,a+Math.PI]].forEach(function(t){
      pc.beginPath();
      pc.moveTo(t[0],t[1]);
      pc.lineTo(t[0]+Math.cos(t[2]+0.4)*5,t[1]+Math.sin(t[2]+0.4)*5);
      pc.moveTo(t[0],t[1]);
      pc.lineTo(t[0]+Math.cos(t[2]-0.4)*5,t[1]+Math.sin(t[2]-0.4)*5);
      pc.stroke();
    });
  }

  function drawPlan(){
    hits=[];
    var W=planC.width,H=planC.height;
    pc.clearRect(0,0,W,H);
    pc.strokeStyle='#262a20';pc.lineWidth=1;
    var step=view.scale,x0=view.ox%step,y0=view.oy%step;
    for(var x=x0;x<W;x+=step){pc.beginPath();pc.moveTo(x,0);pc.lineTo(x,H);pc.stroke();}
    for(var y=y0;y<H;y+=step){pc.beginPath();pc.moveTo(0,y);pc.lineTo(W,y);pc.stroke();}

    var verts=vertices();
    var coll=collisions(),bad={};
    coll.forEach(function(c){if(c.sev<0){bad[c.i]=1;bad[c.j]=1;}});

    // Draw wall segments and points
    if(verts.length>0){
      if(verts.length>1){
        for(var i=0;i<verts.length-1;i++){
          var refSide=1;
          for(var ai=0;ai<anchors.length;ai++){
            if(wallSegIndex(anchors[ai].t)===i){refSide=anchors[ai].side||1;break;}
          }
          var n=segNormalV(verts,i);
          var p=toScreen(verts[i].x,verts[i].y),q=toScreen(verts[i+1].x,verts[i+1].y);
          var off=view.scale*1.3*refSide;
          pc.fillStyle='rgba(111,123,214,0.10)';
          pc.beginPath();
          pc.moveTo(p[0],p[1]);pc.lineTo(q[0],q[1]);
          pc.lineTo(q[0]+n.x*off,q[1]+n.y*off);
          pc.lineTo(p[0]+n.x*off,p[1]+n.y*off);
          pc.closePath();pc.fill();
        }
        for(var i=0;i<verts.length-1;i++){
          var p=toScreen(verts[i].x,verts[i].y),q=toScreen(verts[i+1].x,verts[i+1].y);
          var isSel=sel&&sel.kind==='len'&&sel.idx===i;
          pc.strokeStyle=isSel?'#c6d44a':'#6f7bd6';
          pc.lineWidth=isSel?5:3;
          pc.beginPath();pc.moveTo(p[0],p[1]);pc.lineTo(q[0],q[1]);pc.stroke();
        }
      }
      verts.forEach(function(pt){
        var s=toScreen(pt.x,pt.y);
        pc.fillStyle='#6f7bd6';
        pc.beginPath();pc.arc(s[0],s[1],4,0,7);pc.fill();
      });
      // Segment dimensions
      if(verts.length>1){
        for(var i=0;i<verts.length-1;i++){
          var n=segNormalV(verts,i);
          var p=toScreen(verts[i].x,verts[i].y),q=toScreen(verts[i+1].x,verts[i+1].y);
          var ox=-n.x*20,oy=-n.y*20;
          var isSel=sel&&sel.kind==='len'&&sel.idx===i;
          dimArrows(p[0]+ox,p[1]+oy,q[0]+ox,q[1]+oy,isSel?'#c6d44a':'#5c9fd6',isSel);
          dimText((p[0]+q[0])/2+ox,(p[1]+q[1])/2+oy,
                  wall.segs[i].len.toFixed(2)+' m',
                  isSel?'#c6d44a':'#5c9fd6','len',i,wall.segs[i].lenLock);
        }
        for(var c=1;c<verts.length-1;c++){
          var s=toScreen(verts[c].x,verts[c].y);
          var v1=segVecV(verts,c-1),v2=segVecV(verts,c);
          var isSel=sel&&sel.kind==='ang'&&sel.idx===c;
          pc.strokeStyle=isSel?'#c6d44a':'#b07fd6';
          pc.lineWidth=isSel?2.6:1.2;
          pc.beginPath();
          pc.arc(s[0],s[1],15,Math.atan2(-v1.y,-v1.x),Math.atan2(v2.y,v2.x));
          pc.stroke();
          dimText(s[0]+20,s[1]-17,wall.segs[c].ang.toFixed(0)+'°',
                  isSel?'#c6d44a':'#b07fd6','ang',c,wall.segs[c].angLock);
        }
      }
    }

    anchors.forEach(function(a,idx){
      var g=anchorGeom(a);
      var h=toScreen(g.head[0],g.head[1]);
      var f=toScreen(g.freeEnd[0],g.freeEnd[1]);
      var b=toScreen(g.bondEnd[0],g.bondEnd[1]);
      var freeW=Math.max(2,g.freeR*view.scale*2);
      var bondW=Math.max(3,g.bondR*view.scale*2);
      pc.lineCap='round';
      pc.strokeStyle=bad[idx]?'#e2625a':'#4fb98a';
      pc.lineWidth=idx===selected?freeW+1:freeW;
      pc.beginPath();pc.moveTo(h[0],h[1]);pc.lineTo(f[0],f[1]);pc.stroke();
      pc.strokeStyle=bad[idx]?'#a8403a':'#2f8c66';
      pc.lineWidth=idx===selected?bondW+1:bondW;
      pc.beginPath();pc.moveTo(f[0],f[1]);pc.lineTo(b[0],b[1]);pc.stroke();
      pc.lineCap='butt';
      pc.fillStyle=idx===selected?'#c6d44a':'#cfd3c6';
      pc.beginPath();pc.arc(h[0],h[1],idx===selected?5:3.5,0,7);pc.fill();
      pc.fillStyle='#9aa091';pc.font='10px Segoe UI';
      pc.fillText('K'+(idx+1),h[0]+7,h[1]-6);
    });

    drawChainDims(verts);
  }

  function tAtDev(dev){
    var acc=0;
    for(var i=0;i<wall.segs.length;i++){
      var L=wall.segs[i].len;
      if(dev<=acc+L+1e-9 || i===wall.segs.length-1){
        if(L<=1e-9) return i;
        return i+(dev-acc)/L;
      }
      acc+=L;
    }
    return wall.segs.length-1;
  }

  function drawChainDims(verts){
    if(anchors.length<2||verts.length<2)return;
    var rows={};
    anchors.forEach(function(a,idx){
      var key=Math.round(a.z*100)/100;
      (rows[key]=rows[key]||[]).push(idx);
    });
    Object.keys(rows).forEach(function(key){
      var ids=rows[key];
      ids.sort(function(p,q){return devLengthV(anchors[p].t)-devLengthV(anchors[q].t);});
      // Kóty medzi kotvami rozdelené cez rohy
      for(var m=0;m<ids.length-1;m++){
        var a1=anchors[ids[m]],a2=anchors[ids[m+1]];
        var d1=devLengthV(a1.t), d2=devLengthV(a2.t);
        var start=Math.min(d1,d2), end=Math.max(d1,d2);
        var corners=[];
        var acc=0;
        for(var i=0;i<wall.segs.length-1;i++){
          acc+=wall.segs[i].len;
          // Ak roh leží medzi kotvami
          if(acc>start+1e-9 && acc<end-1e-9) corners.push(acc);
        }
        if(corners.length===0){
          // Klasická kóta medzi kotvami
          var w1=wallPointAtV(verts,a1.t),w2=wallPointAtV(verts,a2.t);
          var s1=toScreen(w1.x,w1.y),s2=toScreen(w2.x,w2.y);
          var i1=wallSegIndex(a1.t),n=segNormalV(verts,i1);
          var refSide=(a1.side||1);
          var ox=n.x*view.scale*0.55*refSide,oy=n.y*view.scale*0.55*refSide;
          var d=Math.abs(end-start);
          dimArrows(s1[0]+ox,s1[1]+oy,s2[0]+ox,s2[1]+oy,'#4fb98a',false);
          dimText((s1[0]+s2[0])/2+ox,(s1[1]+s2[1])/2+oy,d.toFixed(2),'#4fb98a',
                  'chain',{a:ids[m],b:ids[m+1]},false);
        } else {
          // Rozdelené na dve kóty cez roh
          var points=[start].concat(corners,[end]);
          for(var p=0;p<points.length-1;p++){
            var segStart=points[p], segEnd=points[p+1];
            var tStart=tAtDev(segStart), tEnd=tAtDev(segEnd);
            var w1=wallPointAtV(verts,tStart), w2=wallPointAtV(verts,tEnd);
            var s1=toScreen(w1.x,w1.y), s2=toScreen(w2.x,w2.y);
            var i1=wallSegIndex(tStart), n=segNormalV(verts,i1);
            var refSide=(a1.side||1);
            var ox=n.x*view.scale*0.55*refSide, oy=n.y*view.scale*0.55*refSide;
            var d=(segEnd-segStart).toFixed(2);
            dimArrows(s1[0]+ox,s1[1]+oy,s2[0]+ox,s2[1]+oy,'#4fb98a',false);
            dimText((s1[0]+s2[0])/2+ox,(s1[1]+s2[1])/2+oy,d,'#4fb98a',
                    'chain',{a:ids[m],b:ids[m+1]},false);
          }
        }
      }
      // Rozdelenie cez rohy (voliteľné, ak chceš aj túto logiku zachovať)
      /*
      for(var m=0;m<ids.length-1;m++){
        var a1=anchors[ids[m]],a2=anchors[ids[m+1]];
        var d1=devLengthV(a1.t), d2=devLengthV(a2.t);
        var start=Math.min(d1,d2), end=Math.max(d1,d2);
        var corners=[];
        var acc=0;
        for(var i=0;i<wall.segs.length;i++){
          acc+=wall.segs[i].len;
          if(acc>start+1e-9 && acc<end-1e-9) corners.push(acc);
        }
        var points=[start].concat(corners,[end]);
        for(var p=0;p<points.length-1;p++){
          var segStart=points[p], segEnd=points[p+1];
          var tStart=tAtDev(segStart), tEnd=tAtDev(segEnd);
          var w1=wallPointAtV(verts,tStart), w2=wallPointAtV(verts,tEnd);
          var s1=toScreen(w1.x,w1.y), s2=toScreen(w2.x,w2.y);
          var i1=wallSegIndex(tStart), n=segNormalV(verts,i1);
          var refSide=(a1.side||1);
          var ox=n.x*view.scale*0.55*refSide, oy=n.y*view.scale*0.55*refSide;
          var d=(segEnd-segStart).toFixed(2);
          dimArrows(s1[0]+ox,s1[1]+oy,s2[0]+ox,s2[1]+oy,'#4fb98a',false);
          dimText((s1[0]+s2[0])/2+ox,(s1[1]+s2[1])/2+oy,d,'#4fb98a',
                  'chain',{a:ids[m],b:ids[m+1]},false);
        }
      }
      */
    });
  }

  function drawIso(){
    var W=isoC.width,H=isoC.height;
    ic.clearRect(0,0,W,H);
    var verts=vertices();
    var allPts=[];
    anchors.forEach(function(a){var g=anchorGeom(a);allPts.push(g.head,g.bondEnd);});
    verts.forEach(function(p){allPts.push([p.x,p.y,0]);});
    var cx=0,cy=0,cz=0;
    if(allPts.length){
      allPts.forEach(function(p){cx+=p[0];cy+=p[1];cz+=p[2];});
      cx/=allPts.length;cy/=allPts.length;cz/=allPts.length;
    }
    var rot=isoView.rot,sc=isoView.scale;
    function proj(p){
      var x=p[0]-cx,y=p[1]-cy,z=p[2]-cz;
      var sx=(x-y)*Math.cos(rot);
      var sy=(x+y)*Math.sin(rot)*0.5-z;
      return [W/2+sx*sc,H/2+sy*sc+30];
    }
    if(verts.length>1){
      ic.strokeStyle='#33392c';ic.lineWidth=0.5;
      var minx=1e9,maxx=-1e9,miny=1e9,maxy=-1e9;
      verts.forEach(function(p){minx=Math.min(minx,p.x);maxx=Math.max(maxx,p.x);
        miny=Math.min(miny,p.y);maxy=Math.max(maxy,p.y);});
      for(var gx=Math.floor(minx)-1;gx<=maxx+1;gx++){
        var pa=proj([gx,miny-1,0]),pb=proj([gx,maxy+1,0]);
        ic.beginPath();ic.moveTo(pa[0],pa[1]);ic.lineTo(pb[0],pb[1]);ic.stroke();
      }
      for(var gy=Math.floor(miny)-1;gy<=maxy+1;gy++){
        var pa=proj([minx-1,gy,0]),pb=proj([maxx+1,gy,0]);
        ic.beginPath();ic.moveTo(pa[0],pa[1]);ic.lineTo(pb[0],pb[1]);ic.stroke();
      }
      ic.strokeStyle='#6f7bd6';ic.lineWidth=2;
      ic.beginPath();
      var w0=proj([verts[0].x,verts[0].y,0]);ic.moveTo(w0[0],w0[1]);
      for(var i=1;i<verts.length;i++){var wp=proj([verts[i].x,verts[i].y,0]);ic.lineTo(wp[0],wp[1]);}
      ic.stroke();
    }
    var coll=collisions(),bad={};
    coll.forEach(function(c){if(c.sev<0){bad[c.i]=1;bad[c.j]=1;}});
    anchors.forEach(function(a,idx){
      var g=anchorGeom(a);
      var hp=proj(g.head),fp=proj(g.freeEnd),bp=proj(g.bondEnd);
      ic.lineCap='round';
      ic.strokeStyle=bad[idx]?'#e2625a':'#4fb98a';
      ic.lineWidth=Math.max(2,g.freeR*sc*2);
      ic.beginPath();ic.moveTo(hp[0],hp[1]);ic.lineTo(fp[0],fp[1]);ic.stroke();
      ic.strokeStyle=bad[idx]?'#a8403a':'#2f8c66';
      ic.lineWidth=Math.max(3,g.bondR*sc*2.2);
      ic.beginPath();ic.moveTo(fp[0],fp[1]);ic.lineTo(bp[0],bp[1]);ic.stroke();
      ic.lineCap='butt';
      ic.fillStyle='#cfd3c6';
      ic.beginPath();ic.arc(hp[0],hp[1],3,0,7);ic.fill();
      ic.fillStyle='#9aa091';ic.font='9px Segoe UI';
      ic.fillText('K'+(idx+1),hp[0]+5,hp[1]-4);
    });
    coll.forEach(function(c){
      if(c.sev<0){
        var pa=proj(c.pa),pb=proj(c.pb);
        ic.strokeStyle='#e0a83b';ic.lineWidth=1.5;ic.setLineDash([4,3]);
        ic.beginPath();ic.moveTo(pa[0],pa[1]);ic.lineTo(pb[0],pb[1]);ic.stroke();
        ic.setLineDash([]);
        ic.fillStyle='#e0a83b';ic.font='10px Segoe UI';
        ic.fillText(c.clear.toFixed(2)+' m',(pa[0]+pb[0])/2+4,(pa[1]+pb[1])/2);
      }
    });
  }

  function renderStats(){
    var coll=collisions();
    document.getElementById('sCount').textContent=anchors.length;
    var nbad=coll.filter(function(c){return c.sev<0;}).length;
    document.getElementById('sColl').textContent=nbad;
    document.getElementById('sCollBox').className=nbad>0?'stat bad':'stat';
    var mn=coll.length?Math.min.apply(null,coll.map(function(c){return c.clear;})):null;
    document.getElementById('sMin').textContent=mn===null?'–':mn.toFixed(2)+' m';
    var box=document.getElementById('collList');
    if(coll.length===0){box.innerHTML='<div class="empty">Pridaj aspoň dve kotvy.</div>';return;}
    var html='<table><tr><th>Dvojica</th><th>Časti</th><th style="text-align:right">Osová</th>'+
             '<th style="text-align:right">Svetlá</th><th></th></tr>';
    coll.slice(0,12).forEach(function(c){
      var ok=c.sev>=0;
      html+='<tr class="collrow" data-i="'+c.i+'">'+
        '<td>K'+(c.i+1)+' ↔ K'+(c.j+1)+'</td>'+
        '<td style="color:var(--ink2)">'+c.kind+'</td>'+
        '<td style="text-align:right">'+c.axis.toFixed(2)+'</td>'+
        '<td style="text-align:right;font-weight:600">'+c.clear.toFixed(2)+'</td>'+
        '<td style="text-align:right"><span class="pill '+(ok?'ok':'no')+'">'+
          (ok?'OK':'kolízia')+'</span></td></tr>';
    });
    html+='</table>';
    box.innerHTML=html;
    Array.prototype.forEach.call(box.querySelectorAll('.collrow'),function(tr){
      tr.addEventListener('click',function(){
        selected=parseInt(tr.getAttribute('data-i'),10);
        selWall=false;sel=null;syncPanels();redraw();
      });
    });
  }

  function syncPanels(){
    var ap=document.getElementById('anchorPanel'),sp=document.getElementById('selPanel');
    if(sel){
      sp.style.display='block';
      var s=wall.segs[sel.idx];
      if(sel.kind==='len'){
        document.getElementById('selTitle').textContent='Segment steny #'+(sel.idx+1);
        document.getElementById('selBody').innerHTML=
          '<div class="selinfo">'+
          '<div class="row"><span>Dĺžka segmentu</span>'+
            '<input id="selVal" type="number" step="0.1" value="'+s.len.toFixed(2)+
            '" style="width:88px;background:var(--panel);color:var(--ink);'+
            'border:1px solid var(--line);border-radius:5px;padding:4px 6px;"></div>'+
          '<div class="row"><span>Zámok dĺžky</span>'+
            '<button class="lockbtn '+(s.lenLock?'locked':'')+'" id="selLock">'+
            (s.lenLock?'🔒 zamknuté':'🔓 voľné')+'</button></div>'+
          '</div>'+
          '<div class="hint">Zamknutá dĺžka sa nezmení, keď prepíšeš iné kóty alebo ťaháš susedné vrcholy.</div>';
      }else{
        document.getElementById('selTitle').textContent='Uhol lomu vo vrchole #'+(sel.idx+1);
        document.getElementById('selBody').innerHTML=
          '<div class="selinfo">'+
          '<div class="row"><span>Vnútorný uhol (°)</span>'+
            '<input id="selVal" type="number" step="1" value="'+s.ang.toFixed(0)+
            '" style="width:88px;background:var(--panel);color:var(--ink);'+
            'border:1px solid var(--line);border-radius:5px;padding:4px 6px;"></div>'+
          '<div class="row"><span>Zámok uhla</span>'+
            '<button class="lockbtn '+(s.angLock?'locked':'')+'" id="selLock">'+
            (s.angLock?'🔒 zamknuté':'🔓 voľné')+'</button></div>'+
          '</div>'+
          '<div class="hint">Zamknutý uhol drží smer aj keď meníš susedné dĺžky alebo ťaháš vrcholy.</div>';
      }
      var inp=document.getElementById('selVal');
      inp.addEventListener('input',function(){
        var v=parseFloat(this.value);
        if(isNaN(v))return;
        if(sel.kind==='len')setSegLen(sel.idx,v);
        else setSegAngle(sel.idx,v);
        redraw();
      });
      inp.addEventListener('change',function(){snapshot();});
      document.getElementById('selLock').addEventListener('click',function(){
        snapshot();
        toggleLock(sel.kind,sel.idx);
        syncPanels();redraw();
      });
    }else{
      sp.style.display='none';
    }
    if(selected>=0&&anchors[selected]){
      ap.style.display='block';
      var a=anchors[selected];
      var dims=anchorDiameters(a);
      document.getElementById('apTitle').textContent='Kotva K'+(selected+1);
      document.getElementById('apIncline').value=a.incline;
      document.getElementById('apSkew').value=a.skew;
      document.getElementById('apFree').value=a.free;
      document.getElementById('apBond').value=a.bond;
      document.getElementById('apDiaFree').value=dims.freeDia;
      document.getElementById('apDiaBond').value=dims.bondDia;
      document.getElementById('apZ').value=a.z;
    }else{
      ap.style.display='none';
    }
  }

  function redraw(){drawPlan();drawIso();renderStats();}

  var editTarget=null;
  function openEdit(hz){
    var val;
    if(hz.type==='len')val=wall.segs[hz.ref].len;
    else if(hz.type==='ang')val=wall.segs[hz.ref].ang;
    else if(hz.type==='chain')
      val=Math.abs(devLengthV(anchors[hz.ref.b].t)-devLengthV(anchors[hz.ref.a].t));
    editTarget=hz;
    editBox.style.display='block';
    editBox.style.left=hz.x+'px';
    editBox.style.top=hz.y+'px';
    editBox.value=val.toFixed(hz.type==='ang'?0:2);
    editBox.focus();editBox.select();
  }
  function commitEdit(){
    if(!editTarget)return;
    var v=parseFloat(editBox.value);
    if(!isNaN(v)){
      snapshot();
      if(editTarget.type==='len')setSegLen(editTarget.ref,v);
      else if(editTarget.type==='ang')setSegAngle(editTarget.ref,v);
      else if(editTarget.type==='chain')setChainDist(editTarget.ref.a,editTarget.ref.b,v);
    }
    editBox.style.display='none';editTarget=null;
    syncPanels();redraw();
  }
  editBox.addEventListener('keydown',function(e){
    if(e.key==='Enter')commitEdit();
    if(e.key==='Escape'){editBox.style.display='none';editTarget=null;}
  });
  editBox.addEventListener('blur',commitEdit);

  function setChainDist(idA,idB,newD){
    var baseDev=devLengthV(anchors[idA].t);
    var dir=devLengthV(anchors[idB].t)>=baseDev?1:-1;
    setAnchorDev(idB,baseDev+dir*newD);
  }
  function setAnchorDev(idx,targetDev){
    var total=totalWallLen();
    targetDev=Math.max(0,Math.min(total,targetDev));
    var acc=0;
    for(var i=0;i<wall.segs.length;i++){
      var L=wall.segs[i].len;
      if(targetDev<=acc+L||i===wall.segs.length-1){
        anchors[idx].t=i+(targetDev-acc)/(L||1);return;
      }
      acc+=L;
    }
  }

  function nearestT(verts,mx,my){
    var best=0,bd=1e9;
    for(var i=0;i<verts.length-1;i++){
      var p=verts[i],q=verts[i+1];
      var dx=q.x-p.x,dy=q.y-p.y,L2=dx*dx+dy*dy||1;
      var t=((mx-p.x)*dx+(my-p.y)*dy)/L2;t=cl01(t);
      var px=p.x+dx*t,py=p.y+dy*t,d=Math.hypot(mx-px,my-py);
      if(d<bd){bd=d;best=i+t;}
    }
    return {t:best,dist:bd};
  }
  function sideAt(verts,t,mx,my){
    var i=wallSegIndex(t),n=segNormalV(verts,i),wp=wallPointAtV(verts,t);
    return ((mx-wp.x)*n.x+(my-wp.y)*n.y)>=0?1:-1;
  }
  function pickSegment(verts,mx,my){
    for(var i=0;i<verts.length-1;i++){
      var p=verts[i],q=verts[i+1];
      var dx=q.x-p.x,dy=q.y-p.y,L2=dx*dx+dy*dy||1;
      var t=((mx-p.x)*dx+(my-p.y)*dy)/L2;
      if(t<0||t>1)continue;
      var px=p.x+dx*t,py=p.y+dy*t;
      if(Math.hypot(mx-px,my-py)<0.35)return i;
    }
    return -1;
  }
  function pickAngle(verts,mx,my){
    for(var c=1;c<verts.length-1;c++){
      var d=Math.hypot(mx-verts[c].x,my-verts[c].y);
      var rr=15/view.scale;
      if(Math.abs(d-rr)<0.45)return c;
    }
    return -1;
  }

  var drag=null,panning=null;
  planC.addEventListener('mousedown',function(e){
    var r=planC.getBoundingClientRect();
    var sx=(e.clientX-r.left)*planC.width/r.width;
    var sy=(e.clientY-r.top)*planC.height/r.height;
    var m=toModel(sx,sy);
    var verts=vertices();

    if(e.button===1||e.button===2||e.shiftKey){
      panning={sx:sx,sy:sy,ox:view.ox,oy:view.oy};e.preventDefault();return;
    }
    if(mode==='select'){
      for(var z=0;z<hits.length;z++){
        var hz=hits[z];
        if(sx>=hz.x&&sx<=hz.x+hz.w&&sy>=hz.y&&sy<=hz.y+hz.h){
          if(hz.type==='len'){sel={kind:'len',idx:hz.ref};selected=-1;selWall=false;syncPanels();redraw();return;}
          if(hz.type==='ang'){sel={kind:'ang',idx:hz.ref};selected=-1;selWall=false;syncPanels();redraw();return;}
          if(hz.type==='chain'){openEdit(hz);return;}
        }
      }
      for(var vi=0;vi<verts.length;vi++){
        if(Math.hypot(m[0]-verts[vi].x,m[1]-verts[vi].y)<0.4){
          snapshot();drag={type:'vertex',idx:vi};return;
        }
      }
      var ba=-1,bd=1e9;
      anchors.forEach(function(a,idx){
        var g=anchorGeom(a);
        var d=Math.hypot(m[0]-g.head[0],m[1]-g.head[1]);
        if(d<bd){bd=d;ba=idx;}
      });
      if(ba>=0&&bd<0.5){
        selected=ba;sel=null;selWall=false;snapshot();
        drag={type:'anchor',idx:ba};syncPanels();redraw();return;
      }
      var pa=pickAngle(verts,m[0],m[1]);
      if(pa>=0){sel={kind:'ang',idx:pa};selected=-1;syncPanels();redraw();return;}
      var ps=pickSegment(verts,m[0],m[1]);
      if(ps>=0){sel={kind:'len',idx:ps};selected=-1;syncPanels();redraw();return;}
      sel=null;selected=-1;selWall=false;syncPanels();redraw();
    }
  });
  window.addEventListener('mousemove',function(e){
    var r=planC.getBoundingClientRect();
    var sx=(e.clientX-r.left)*planC.width/r.width;
    var sy=(e.clientY-r.top)*planC.height/r.height;
    if(panning){
      view.ox=panning.ox+(sx-panning.sx);
      view.oy=panning.oy+(sy-panning.sy);
      redraw();return;
    }
    if(!drag)return;
    var m=toModel(sx,sy);
    if(drag.type==='vertex'){
      var verts=vertices();
      verts[drag.idx].x=m[0];verts[drag.idx].y=m[1];
      rebuildRespectingLocks(verts);
    }else if(drag.type==='anchor'){
      anchors[drag.idx].t=nearestT(vertices(),m[0],m[1]).t;
    }
    redraw();
  });
  window.addEventListener('mouseup',function(){
    if(drag&&drag.type==='anchor')syncPanels();
    drag=null;panning=null;
  });
  planC.addEventListener('contextmenu',function(e){e.preventDefault();});

  planC.addEventListener('click',function(e){
    if(mode==='select'||e.shiftKey)return;
    var r=planC.getBoundingClientRect();
    var sx=(e.clientX-r.left)*planC.width/r.width;
    var sy=(e.clientY-r.top)*planC.height/r.height;
    var m=toModel(sx,sy);
    if(mode==='wall'){
      snapshot();
      var verts=vertices();
      if (!wall.origin) {
        // Prvý bod
        rebuildFromVertices([{x:Math.round(m[0]*4)/4, y:Math.round(m[1]*4)/4}]);
      } else {
        verts.push({x:Math.round(m[0]*4)/4,y:Math.round(m[1]*4)/4});
        rebuildFromVertices(verts);
      }
    }else if(mode==='anchor'){
      var verts=vertices();
      if(verts.length<2){flash('Najprv nakresli aspoň dvojbodovú stenu.');return;}
      var nt=nearestT(verts,m[0],m[1]);
      snapshot();
      anchors.push({t:nt.t,z:-2,incline:20,skew:0,free:8,bond:6,dia:150,
                    freeDia:150,bondDia:150,
                    side:sideAt(verts,nt.t,m[0],m[1])});
      selected=anchors.length-1;sel=null;syncPanels();
    }
    redraw();
  });

  planC.addEventListener('wheel',function(e){
    e.preventDefault();
    var r=planC.getBoundingClientRect();
    var sx=(e.clientX-r.left)*planC.width/r.width;
    var sy=(e.clientY-r.top)*planC.height/r.height;
    var before=toModel(sx,sy);
    view.scale*=e.deltaY<0?1.12:0.89;
    view.scale=Math.max(6,Math.min(90,view.scale));
    view.ox=sx-before[0]*view.scale;
    view.oy=sy-before[1]*view.scale;
    document.getElementById('planScale').textContent='mierka: '+view.scale.toFixed(0)+' px/m · koliesko = zoom';
    redraw();
  },{passive:false});

  var isoDrag=false,isoLast=0;
  isoC.addEventListener('mousedown',function(e){isoDrag=true;isoLast=e.clientX;});
  window.addEventListener('mouseup',function(){isoDrag=false;});
  window.addEventListener('mousemove',function(e){
    if(!isoDrag)return;
    isoView.rot+=(e.clientX-isoLast)*0.01;isoLast=e.clientX;drawIso();
  });
  isoC.addEventListener('wheel',function(e){
    e.preventDefault();
    isoView.scale*=e.deltaY<0?1.1:0.9;
    isoView.scale=Math.max(4,Math.min(40,isoView.scale));
    drawIso();
  },{passive:false});

  function bindAnchor(id,key){
    document.getElementById(id).addEventListener('input',function(){
      if(selected<0)return;
      anchors[selected][key]=parseFloat(this.value)||0;redraw();
    });
  }
  ['apIncline:incline','apSkew:skew','apFree:free','apBond:bond','apZ:z']
    .forEach(function(s){var p=s.split(':');bindAnchor(p[0],p[1]);});
  document.getElementById('apDiaFree').addEventListener('input',function(){
    if(selected<0)return;
    anchors[selected].freeDia=parseFloat(this.value)||0;redraw();
  });
  document.getElementById('apDiaBond').addEventListener('input',function(){
    if(selected<0)return;
    anchors[selected].bondDia=parseFloat(this.value)||0;redraw();
  });
  document.getElementById('apFlip').addEventListener('click',function(){
    if(selected<0)return;snapshot();
    anchors[selected].side=-(anchors[selected].side||1);redraw();
  });
  document.getElementById('apDel').addEventListener('click',function(){
    if(selected<0)return;snapshot();
    anchors.splice(selected,1);selected=-1;syncPanels();redraw();
  });
  document.getElementById('limBond').addEventListener('input',redraw);
  document.getElementById('limFree').addEventListener('input',redraw);

  function setMode(m){
    mode=m;
    [['wall','m-wall'],['anchor','m-anchor'],['select','m-select']].forEach(function(p){
      document.getElementById(p[1]).className=(p[0]===m)?'on':'';
    });
    var txt={wall:'Režim: kresliť stenu — klikaj vrcholy lomenej steny',
             anchor:'Režim: osadiť kotvu — klikni pri stene na stranu do zeminy',
             select:'Režim: výber — klikni na čiaru, oblúk uhla alebo kótu; ťahaj vrcholy a kotvy'}[m];
    document.getElementById('planMode').textContent=txt;
    planC.style.cursor=m==='select'?'pointer':'crosshair';
  }
  document.getElementById('m-wall').onclick=function(){setMode('wall');};
  document.getElementById('m-anchor').onclick=function(){setMode('anchor');};
  document.getElementById('m-select').onclick=function(){setMode('select');};
  document.getElementById('b-flip').onclick=function(){
    snapshot();anchors.forEach(function(a){a.side=-(a.side||1);});redraw();
  };
  document.getElementById('b-undo').onclick=undo;
  document.getElementById('b-clear').onclick=function(){
    snapshot();wall={origin:{x:0,y:0},startDir:0,segs:[]};anchors=[];
    selected=-1;selWall=false;sel=null;syncPanels();redraw();flash('Vymazané.');
  };
  document.getElementById('b-demo').onclick=function(){
    snapshot();
    var pts=[{x:2,y:6},{x:9,y:6},{x:14,y:11},{x:14,y:18}];
    rebuildFromVertices(pts);
    anchors=[];
    [0.35,0.7,1.4,2.5].forEach(function(t){
      [-2,-5].forEach(function(z){
        anchors.push({t:t,z:z,incline:z<-3?15:25,skew:0,free:8,bond:6,dia:150,side:1});
      });
    });
    anchors[4].skew=20;
    selected=-1;selWall=false;sel=null;
    view={ox:60,oy:40,scale:22};
    syncPanels();redraw();
    flash('Načítaný príklad: parametrická lomená stena, 4 kotvy × 2 rady.');
  };

  document.getElementById('b-save').onclick=function(){
    var data={version:5,wall:wall,anchors:anchors,
              limBond:document.getElementById('limBond').value,
              limFree:document.getElementById('limFree').value};
    var blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='kotvy-projekt.json';a.click();
    flash('Projekt uložený ako kotvy-projekt.json');
  };
  document.getElementById('b-load').onclick=function(){
    var inp=document.createElement('input');
    inp.type='file';inp.accept='.json,application/json';
    inp.onchange=function(){
      var f=inp.files[0];if(!f)return;
      var rd=new FileReader();
      rd.onload=function(){
        try{
          var d=JSON.parse(rd.result);snapshot();
          if(d.wall&&d.wall.segs){wall=d.wall;}
          else if(d.wall&&d.wall.length){rebuildFromVertices(d.wall);} 
          anchors=d.anchors||[];
          if(d.limBond)document.getElementById('limBond').value=d.limBond;
          if(d.limFree)document.getElementById('limFree').value=d.limFree;
          selected=-1;selWall=false;sel=null;syncPanels();redraw();
          flash('Projekt načítaný.');
        }catch(err){flash('Chyba: súbor sa nepodarilo načítať.');}
      };
      rd.readAsText(f);
    };
    inp.click();
  };

  function dxfLine(x1,y1,z1,x2,y2,z2,layer){
    return ['0','LINE','8',layer,
            '10',x1.toFixed(3),'20',y1.toFixed(3),'30',z1.toFixed(3),
            '11',x2.toFixed(3),'21',y2.toFixed(3),'31',z2.toFixed(3)].join('\n')+'\n';
  }
  function dxfText(x,y,z,h,txt,layer){
    return ['0','TEXT','8',layer,
            '10',x.toFixed(3),'20',y.toFixed(3),'30',z.toFixed(3),
            '40',h.toFixed(3),'1',txt].join('\n')+'\n';
  }
  document.getElementById('b-dxf').onclick=function(){
    if(anchors.length===0){flash('Najprv pridaj kotvy.');return;}
    var verts=vertices();
    var s='0\nSECTION\n2\nENTITIES\n';
    for(var i=0;i<verts.length-1;i++)
      s+=dxfLine(verts[i].x,-verts[i].y,0,verts[i+1].x,-verts[i+1].y,0,'STENA');
    anchors.forEach(function(a,idx){
      var g=anchorGeom(a);
      s+=dxfLine(g.head[0],-g.head[1],g.head[2],g.freeEnd[0],-g.freeEnd[1],g.freeEnd[2],'KOTVA_VOLNA');
      s+=dxfLine(g.freeEnd[0],-g.freeEnd[1],g.freeEnd[2],g.bondEnd[0],-g.bondEnd[1],g.bondEnd[2],'KOTVA_KOREN');
      s+=dxfText(g.head[0],-g.head[1],g.head[2],0.3,'K'+(idx+1),'POPIS');
    });
    collisions().forEach(function(c){
      if(c.sev<0){
        s+=dxfLine(c.pa[0],-c.pa[1],c.pa[2],c.pb[0],-c.pb[1],c.pb[2],'KOLIZIA');
        var mx=(c.pa[0]+c.pb[0])/2,my=-(c.pa[1]+c.pb[1])/2,mz=(c.pa[2]+c.pb[2])/2;
        s+=dxfText(mx,my,mz,0.3,'K'+(c.i+1)+'-K'+(c.j+1)+' '+c.clear.toFixed(2)+'m','KOLIZIA');
      }
    });
    s+='0\nENDSEC\n0\nEOF\n';
    var blob=new Blob([s],{type:'application/dxf'});
    var a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download='kotvy-3d.dxf';a.click();
    flash('DXF exportované — vrstvy STENA, KOTVA_VOLNA, KOTVA_KOREN, KOLIZIA.');
  };

  function flash(msg){document.getElementById('fLeft').textContent=msg;}
  function resize(){
    [planC,isoC].forEach(function(c){
      var r=c.getBoundingClientRect();
      c.width=Math.round(r.width);c.height=Math.round(r.height);
    });
    redraw();
  }
  window.addEventListener('resize',resize);
  window.addEventListener('keydown',function(e){
    if((e.ctrlKey||e.metaKey)&&e.key==='z'){e.preventDefault();undo();}
  });

  resize();
  setMode('wall');
})();
