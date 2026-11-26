import json, pathlib
out=pathlib.Path("tests/vectors")
TABLE=[]
for i in range(256):
    c=i
    for _ in range(8): c=((c<<1)^0x07)&0xFF if c&0x80 else (c<<1)&0xFF
    TABLE.append(c)
def crc(p):
    c=0
    for b in p.encode(): c=TABLE[c^b]
    return c
def line(p,bad=False):
    x=(crc(p)+1)&0xFF if bad else crc(p)
    return f"V3 {p} {x:02X}\n"
PAY={"A":"GRGRRRRRRRRRSSSS","B":"RGRGRRRRRRRRSSSS","FL":"FFFFFFFFFFFFSSSS","CONF":"GGRRRRRRRRRRSSSS"}
L={k:line(v) for k,v in PAY.items()}; L["BAD"]=line(PAY["A"],bad=True)
F="FFFFFFFFFFFFSSSS"; R="RRRRRRRRRRRRSSSS"
sc=[]
def add(name, seconds, expect, settings=None):
    sc.append({"name":name,"settings":settings or {"watchdog_s":3,"recover_messages":3,"recover_all_red_s":3},
               "seconds":[[L[n] for n in names] for names in seconds],
               "expect":[{"second":s,"state":st,"display":d} for s,st,d in expect]})
rep=lambda n,k: [[n]]*k
add("power up: flash, three good seconds, three seconds all red, then the host",
    rep("A",10),[(0,"fault",F),(1,"fault",F),(2,"recover",R),(3,"recover",R),(4,"recover",R),(5,"run",PAY["A"]),(9,"run",PAY["A"])])
add("a gap shorter than the watchdog is tolerated",
    rep("A",10)+[[],[],["A"],["A"]],[(9,"run",PAY["A"]),(10,"run",PAY["A"]),(11,"run",PAY["A"]),(12,"run",PAY["A"])])
add("silence for the watchdog time trips a fault, and recovery follows the host again",
    rep("A",10)+[[]]*4+rep("B",7),
    [(11,"run",PAY["A"]),(12,"fault",F),(13,"fault",F),(14,"fault",F),(15,"fault",F),(16,"recover",R),(17,"recover",R),(18,"recover",R),(19,"run",PAY["B"]),(20,"run",PAY["B"])])
add("damaged lines count as silence",
    rep("A",10)+[["BAD"],["BAD","BAD"],["BAD"],["A"]],
    [(11,"run",PAY["A"]),(12,"fault",F),(13,"fault",F)])
add("a damaged line next to a good one is harmless",
    rep("A",10)+[["BAD","A"]]*6,[(10,"run",PAY["A"]),(15,"run",PAY["A"])])
add("an intact but conflicting line trips the fault at once",
    rep("A",10)+[["CONF"]]+rep("A",7),
    [(9,"run",PAY["A"]),(10,"fault",F),(11,"fault",F),(12,"fault",F),(13,"recover",R),(14,"recover",R),(15,"recover",R),(16,"run",PAY["A"])])
add("a conflict while recovering returns to the fault",
    rep("A",3)+[["CONF"]]+rep("A",7),
    [(2,"recover",R),(3,"fault",F),(4,"fault",F),(5,"fault",F),(6,"recover",R),(7,"recover",R),(8,"recover",R),(9,"run",PAY["A"])])
add("two good lines in one second count once",
    [["A","A"]]*10,[(0,"fault",F),(1,"fault",F),(2,"recover",R),(5,"run",PAY["A"])])
add("a gap resets the recovery count",
    [["A"],["A"],[],["A"],["A"],["A"],["A"],["A"],["A"],["A"]],
    [(0,"fault",F),(1,"fault",F),(2,"fault",F),(3,"fault",F),(4,"fault",F),(5,"recover",R),(6,"recover",R),(7,"recover",R),(8,"run",PAY["A"])])
add("silence while recovering trips the fault again",
    rep("A",3)+[[]]*4,[(2,"recover",R),(3,"recover",R),(4,"recover",R),(5,"fault",F),(6,"fault",F)])
add("the host's own startup flash frames are followed once running",
    rep("FL",7)+rep("A",4),
    [(0,"fault",F),(1,"fault",F),(2,"recover",R),(3,"recover",R),(4,"recover",R),(5,"run",F),(6,"run",F),(7,"run",PAY["A"]),(10,"run",PAY["A"])])
add("a shorter watchdog, one good line to recover and no all-red wait",
    [["A"],["A"],[],[],["A"],["A"]],
    [(0,"run",PAY["A"]),(1,"run",PAY["A"]),(2,"run",PAY["A"]),(3,"fault",F),(4,"run",PAY["A"]),(5,"run",PAY["A"])],
    {"watchdog_s":2,"recover_messages":1,"recover_all_red_s":0})
add("no line ever arrives",[[]]*6,[(0,"fault",F),(5,"fault",F)])
add("only damaged lines ever arrive",[["BAD"]]*6,[(0,"fault",F),(5,"fault",F)])
add("a conflict wins over a good line before it in the same second",
    rep("A",10)+[["A","CONF"]]+rep("A",7),[(10,"fault",F),(11,"fault",F),(12,"fault",F),(13,"recover",R),(16,"run",PAY["A"])])
add("a good line after a conflict in the same second does not count towards recovery",
    rep("A",10)+[["CONF","A"]]+rep("A",7),[(10,"fault",F),(11,"fault",F),(12,"fault",F),(13,"recover",R),(16,"run",PAY["A"])])
(out/"monitor_scenarios.json").write_text(json.dumps(sc,indent=1))
print(len(sc))
