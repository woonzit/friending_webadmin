# Operátori útmutató: színezés, landing/hero elemek és kötelező hitelesítés

Kinek szól: a Friending tulajdonosának és az adminisztrátoroknak, akik
országonként állítják be az app kinézetét, és akik eldöntik, mikor válik
kötelezővé a hitelesítés. Mérnöki tudás nem kell hozzá. A dokumentum angol
ikerpárja: `operator-guide-appearance-and-mandatory-verification.en.md`; ugyanazokat
a képernyőket írják le.

Két konzolról van szó:

1. **Megjelenés és elhelyezések** (`/appearance`) — már élesben van. A landing
   képernyő, a Discover hero-körhinta és a világos/sötét kiemelőszín-paletta,
   App Store áruház-országonként vagy földrajzi területenként.
2. **Hitelesítés → Területek** — az EGYETLEN táblázat, amely eldönti, melyik
   hitelesítési módszer kötelező globálisan és App Store áruház-országonként, és
   amely soronként a Váróterem szövegét is kezeli. Azoknak az
   adminisztrátoroknak jelenik meg, akiknek a Core-fiókja megkapta a
   módszerkonzol jogosultságát; külön kapcsolót nem kell kérned. Mielőtt bárhol
   kötelezővé teszel egy módszert, olvasd el a végén a bevezetési szabályt.

Amit itt módosítasz, azt a Core tárolja, az e-mail-címeddel bekerül az
audit-naplóba, és app-frissítés nélkül érvényesül a tagoknál.

---

## 1. Megjelenés és elhelyezések

### 1.1 Hogyan épülnek egymásra a szintek

Négy szint válaszol arra a kérdésre, hogy „mit lásson ez a tag?", és az első
illeszkedő nyer:

| Szint | Mikor illeszkedik | Tipikus használat |
|---|---|---|
| Geo szabály | A tag éppen egy városban vagy térképkörön belül van | Városi kampány, fesztivál, nyitóesemény |
| Áruház-ország szabály | A tag App Store áruház-országa (ahol az Apple-fiókja vásárol) | Országos megjelenés |
| Globális szabály | Mindenki | Az állandó alap megjelenés |
| Beépített alapértékek | Nincs beállítva semmi | Az appba fordított márkaszínek |

Két ökölszabály:

- **Az üres mező öröklést jelent, nem ürességet.** Amit üresen hagysz, azt az
  alatta lévő szintről veszi. Csak azt töltöd ki, ami tényleg eltér.
- **A geo erősebb az áruház-országnál, az pedig a globálisnál.** Ha két azonos
  fajtájú szabály fedi egymást, az általad megadott prioritás dönt; két azonos
  prioritású geo szabálynál a közelebbi középpont nyer, majd a kisebb sugár,
  majd az újabb szabály.

Az oldalon a szabálylista pontosan ebben a feloldási sorrendben jelenik meg,
így fentről lefelé olvasva látod, mit fog kapni egy tag.

### 1.2 A globális szabály az első

Mindig pontosan egy globális szabály van, és nem törölhető. Ez adja az alapot,
amelyből minden felülírás örököl, ezért ezt állítsd be rendesen, mielőtt bármi
mást létrehoznál: a landing hátteret, a hero-körhintát és mindkét palettát.

### 1.3 Áruház-ország szabály létrehozása

Akkor használd, ha egy egész ország nézzen ki másképp — például más landing kép
az Egyesült Államokban.

1. Nyomd meg az **Új szabály** gombot, és válaszd az **Áruház-ország**
   hatókört.
2. Válaszd ki az országot. Ez az **App Store áruház-ország**, vagyis a tag
   Apple-fiókjának országa — nem a jelenlegi tartózkodási helye és nem a
   telefonszáma. Egy New Yorkban nyaraló magyar tag továbbra is a magyar
   áruház-ország szabályát kapja.
3. Csak azokat a mezőket töltsd ki, amelyek eltérnek a globális szabálytól. A
   többit hagyd üresen, hogy tovább örököljön.
4. Állítsd be a **Prioritást**, ha egy másik áruház-ország szabály is
   lefedhetné ugyanazt az országot.
5. Amíg összeállítod, hagyd a szabályt **inaktívan**.

### 1.4 Geo szabály létrehozása (térképválasztó és városkeresés)

Akkor használd, ha a tag *pillanatnyi helyzete* döntsön, például egy budapesti
hétvégi kampánynál.

1. Nyomd meg az **Új szabály** gombot, és válaszd a **Geo** hatókört.
2. Írj be egy várost a keresőbe, és válassz egy találatot. A középpont
   koordinátái, a javasolt sugár, a címke és az ország automatikusan kitöltődik.
   A keresésre a Core válaszol, nem a böngésző.
3. Finomíts a jelölő húzásával a térképen, vagy írd be közvetlenül a
   koordinátákat. Állítsd be a **sugarat kilométerben** — a térképen látható kör
   az, amihez a tagokat illesztjük.
4. Ha nem jelenik meg a térkép, a konzol böngészős térképkulcs nélkül fut. Ez
   nem hiba: a koordináta- és sugármezők önmagukban pontosan meghatározzák a
   szabályt, a térkép csak kényelmi eszköz.

A tag akkor illeszkedik, ha a pillanatnyi helye a körön belülre esik, így egy
geo szabály ugyanarra a személyre utazás közben hol érvényes, hol nem.

### 1.5 Eseményablak és aktív állapot

- Az **Aktív** dönti el, hogy a Core egyáltalán figyelembe veszi-e a szabályt. A
  vázlatot tartsd inaktívan, amíg a média és a szöveg jóvá nincs hagyva.
- A **kezdet** és a **vég** megadása nem kötelező. Együtt eseményablakot
  alkotnak: a szabály csak ezen belül old fel, a kezdő pillanatot beleértve, a
  záró pillanatot kizárva. Helyi idő szerint írd be; a szerkesztő alatta
  megmutatja az UTC megfelelőt, a szerver ezt tárolja.
- Az ablakán kívüli szabály egyszerűen kimarad, és a következő szint érvényesül.
  Ez nem hibaállapot, az esemény után nincs teendő vele.

### 1.6 A landing képernyő

A mezők, mindegyik önállóan öröklődik, ha üresen hagyod:

- **Háttér**: kép vagy videó. A videóhoz tartozhat **poszter** — az az állókép,
  amely a videó betöltése alatt látszik. A posztert csak videóháttér fölött
  használjuk; képháttérnél figyelmen kívül marad.
- **Cím**: vagy szöveg mindkét nyelven, vagy képcím (logószerű kép). A kép
  nélküli képcímet mentéskor visszautasítjuk, ahelyett hogy törött kép menne ki
  a tagoknak.
- **Leírás**: szöveg mindkét nyelven.

A szöveges mezőket mindig töltsd ki angolul és magyarul is. Az angol a
tartalék: aki bármilyen harmadik nyelvre állította a telefonját, az angol
szöveget látja.

A szerkesztő melletti telefon-előnézettel ellenőrizd a *feloldott* eredményt,
vagyis a szabályodat az örökölt tartalom tetején.

### 1.7 A Discover hero-körhinta

Minden szabály vagy **örökli** a körhintát, vagy **lecseréli** a saját, sorrendbe
állított kártyáira. A cserét csak akkor válaszd, ha ez a közönség tényleg más
körhintát lásson; részleges összefésülés nincs.

- A kártyák képek vagy videók, kétnyelvű szöveggel és opcionális tipográfiával.
- Az általad megadott sorrendben lapoznak a tagok.
- Az **üres csere elrejti a körhintát** az illeszkedő tagok elől. Ez jogos
  választás, de győződj meg róla, hogy szándékos.

### 1.8 Világos és sötét paletta

Módonként öt színszerep:

| Szerep | Hol látszik |
|---|---|
| Fő kiemelőszín | Elsődleges gombok, aktív fül, kiemelések |
| Lenyomott | A kiemelőszín, amíg a gombot nyomva tartják |
| Halvány háttér | Színezett háttér a kiemelt blokkok mögött |
| Kiemelésen lévő szöveg | Kiemelőszínű felületre nyomtatott feliratok |
| Inaktív | Letiltott vezérlők és inaktív fülek |

Minden szerep vagy **örökölt**, vagy `#RRGGBB` színre állított ebben a
szabályban. Csak azoknál a szerepeknél vedd ki az *Öröklés* pipát, amelyeket ez
a szabály módosítson. Mindkét mód kimegy az appba, ezért mentés előtt nézd meg a
világos és a sötét előnézetet is — és mindenekelőtt tartsd olvashatónak a
**kiemelésen lévő szöveget** a kiemelőszínen, mindkét módban.

### 1.9 Előnézet tesztelt helyre

Élesítés előtt használd az előnézet-panelt. Add meg az áruház-országot és a
koordinátákat úgy, ahogy egy valódi eszköz küldené, vagy egy IP-címet, és a Core
pontosan azt adja vissza, amit az app kapna: melyik szabály illeszkedett, a
feloldott landing, a hero-lista és a palettaminták.

Ezt a Core számolja, nem a böngésző, tehát a futtatás pillanatában tárolt
szabályokat tükrözi. Ez az őszinte végső ellenőrzés — ezt hidd el, ne a
szerkesztő előnézeteit.

### 1.10 Mentés: ütközés és bizonytalan eredmény

Minden mentés magával viszi a betöltött revíziószámot, így két adminisztrátor
sosem írja felül egymást észrevétlenül.

- **Siker**: a visszajelzés megnevezi a szabályt és az új revíziót.
- **Ütközés (HTTP 409)**: valaki más módosította a szabályt, miután megnyitottad.
  A vázlatod *nem* íródott ki. Töltsd újra a szabályt, alkalmazd rá ismét a
  módosításodat a friss tartalmon, és ments.
- **Bizonytalan eredmény** (időtúllépés, megszakadt kapcsolat): a válasz nem
  érkezett meg, így senki nem tudja, kiíródott-e. A konzol szándékosan a hiteles
  állapotot tölti újra, ahelyett hogy kétszer küldené el ugyanazt. Nézd meg, mit
  mutat az újratöltött szabály, és utána dönts. Ezért nem fordulhat elő, hogy egy
  szabály kétszer jön létre.

---

## 2. Hitelesítés → Területek: a kötelező módszer

Ez az EGYETLEN hely, ahol a hitelesítés kötelezővé válik. Amíg nem teszel közzé
egy módszerrel ellátott sort, semmi sem érinti a tagokat. Korábban két hely volt
— egy módszerlista a helyalapú területeken és egy külön „Kötelező hitelesítés és
Váróterem" fül —, és ellentmondhattak egymásnak. Mostantól egyetlen táblázat.

### 2.1 Mit jelent a tagnak a kötelező módszer

Az a tag, aki nem teljesítette a kötelező módszert, a **Váróterembe** kerül: egy
teljes képernyős oldalra, amely leváltja az app szokásos felületeit. Onnan
elindíthatja a hitelesítést, elérheti a támogatást, kijelentkezhet vagy törölheti
a saját fiókját — mást nem. A böngészés, a csevegés és a profilok zárva vannak,
amíg nem hitelesített.

Ez súlyos kapcsoló. Mielőtt bárhol bekapcsolod, olvasd el a 2.6-ot.

### 2.2 Egy sor, egy módszer

A táblázat minden sora pontosan EGY értéket hordoz:

- **Persona igazolvány-ellenőrzés** — a személyazonosság-ellenőrzés.
- **Szelfivideó** — a moderátor által átnézett videós szelfi.
- **Nincs** — az adott sorban semmi sem kötelező.

„Mindkettő" nincs. A tagtól sosem kérünk egyszerre két módszert.

Az első sor a **globális** sor: minden felülírás nélküli áruház-országra és
minden ismeretlen áruház-országú tagra vonatkozik. Alatta **áruház-országos
felülírásokat** adhatsz hozzá az App Store országlistájából. A felülírás
lecseréli a globális értéket az adott áruház-országra — csere, nem kiegészítés.

Az a módszer, amelyet a deployment ma nem tud kiszolgálni, látszik, de nem tehető
közzé; a sor megmondja, miért (például „a deployment feloldás ki van kapcsolva").
A már élő érték akkor is látható marad, ha a módszere később elérhetetlenné
válik.

### 2.3 A teljesítés egyszer számít, bármelyik módszer adta

Az a tag, aki már teljesítette a Personát vagy a szelfivideót, akinek a
hitelesítése a régi rendszerből lett importálva, vagy akinek aktív admin grantje
van, kötelezőmódszer-váltáskor is hitelesített marad. Egy már hitelesített tagot
sosem küldesz vissza egy második módszerre.

### 2.4 A Váróterem szövege soronként

A sor **Váróterem-szöveg szerkesztése** gombjával szerkesztheted a címet, az
alcímet és a leírást angolul és magyarul. A globális soron mindkét nyelv
kötelező; áruház-országos soron az üresen hagyott mező az azonos nyelvű globális
szöveget örökli.

Mindkét nyelvhez tartozik egy opcionális **súgó URL** is. Ha be van állítva, a
Váróterem jobb felső sarkában megjelenik egy kerek „?" gomb, amely app-on belüli
böngészőlapon nyitja meg a címet; ha üresen hagyod, nincs gomb. A címnek
`https://`-sel kell kezdődnie, legfeljebb 2048 bájt lehet, és nem tartalmazhat
hitelesítő adatot. Az üresen hagyott áruház-országos sor a globális URL-t örökli,
pontosan úgy, mint a három szövegmező, és a telefon-előnézet csak ott mutatja a
gombot, ahol van tényleges URL. Az URL csak megjelenítés: sosem engedi át a tagot
a kapun.

Két gyakorlati megjegyzés:

- A széleken lévő közönséges szóközöket a rendszer automatikusan levágja. Az a
  „szóköz", amely nem törhető vagy más Unicode-szóköz, viszont elutasításra
  kerül, mert üresnek látszik, miközben nem az. Ha egy beillesztett szöveget
  ezért utasít el a rendszer, gépeld újra a széleket.
- A szerkesztő alatti előnézet világos és sötét módban mutatja az adott sor
  telefonképernyőjét. Ha egy mező még nem érvényes, az előnézet a beépített
  fordítási szöveget mutatja arra a mezőre, és jelzi is — így mindig valósághű
  képet látsz.

### 2.5 Draft, hatás-előnézet, közzététel — ebben a sorrendben

Amit begépelsz, addig nem élő, amíg közzé nem teszed, a közzététel pedig három
lépés:

1. **Draft mentése.** A draft a betöltött revízióhoz mentődik. Ha közben valaki
   más módosította a szabályzatot, ütközést kapsz, a draftod nem íródik ki, és a
   hiteles verzió jelenik meg.
2. **Hatás előnézete.** A Core áruház-országonként megszámolja, hány tag van most
   Váróteremben, hányat tenne oda a mentett draft, hányan teljesítik már, és
   hányan kerülnének újonnan Váróterembe vagy oldódnának fel. Csak darabszámok —
   sosem nevek vagy tagi adatok.
3. **Áttekintett draft közzététele.** Írd be pontosan a megadott kifejezést, adj
   meg privát indokot, és tedd közzé. Pontosan azt a revíziót teszed közzé,
   amelyet előnéztél: bármilyen szerkesztés vagy más mentése érvényteleníti az
   előnézetet, és újat kell készítened.

A magas „újonnan Váróterembe kerül" számot üzleti döntésként kezeld, ne technikai
részletként: azok a tagok elveszítik a hozzáférést az apphoz, amíg nem
hitelesítenek.

### 2.6 A bevezetési szabály — ezt ne hagyd ki

**Csak azután tegyél kötelezővé egy módszert, hogy a Várótermet tartalmazó iOS
build élesben van az App Store-ban.**

Az ok egyszerű. A kaput a szerver kényszeríti ki minden app-verzióra. A régebbi
app, amely nem ismeri a Várótermet, úgy kapja meg az elutasítást, hogy nincs
hozzá megjeleníthető képernyője, így a tag zsákutcát lát a hitelesítés útja
helyett. A tagok nem mind ugyanazon a napon frissítenek, ezért:

1. A Várótermet tartalmazó iOS kiadás megjelenik az App Store-ban.
2. Várd meg, amíg az aktív tagok túlnyomó többsége arra frissült (nézd meg az
   analitikát; néhány nap normális).
3. Csak ezután tegyél közzé kötelező módszert, és először inkább egyetlen
   áruház-országban.
4. Egy napig figyeld a support-forgalmat, mielőtt szélesítenél.

Ha egy sort visszaállítasz **Nincs** értékre és közzéteszed, az azonnal és
biztonságosan hat: a tagok a következő kérésüknél visszakerülnek az appba.

### 2.7 Hol van a videós termék saját oldala

A **Konfiguráció → Videós profilhitelesítés** továbbra is a videós folyamat
szövegét, felszólításait és megjelenését kezeli. Engedélyező kapcsolója már
nincs: azt, hogy a videó kötelező-e, itt, a Területek táblázatban döntöd el, és
az az oldal csak olvasható sorként mutatja a származtatott választ.

---

## 3. Gyors válaszok

**Egy tag szerint rosszul néz ki az app az országában.** Futtasd a teszt-
előnézetet az ő áruház-országával és helyével. Az illeszkedő szabály megmondja,
melyik szint a felelős.

**Egy kampánynak ma este véget kell érnie.** A szabály törlése helyett állítsd be
a záró pillanatot az eseményablakban; magától megszűnik feloldani, és az alatta
lévő szint veszi át.

**Azt szeretném, hogy egy ország megtartsa a régi kinézetet.** Adj annak az
áruház-országnak egy szabályt, amely pontosan a globálisan módosított mezőket
állítja vissza a régi értékekre.

**A színek világos módban jók, sötétben olvashatatlanok.** A két mód külön van;
ellenőrizd a „kiemelésen lévő szöveget" a sötét előnézetben.

**Eljutott a módosításom a tagokhoz?** A szabálylista mutatja az élő állapotot; a
teszt-előnézet pedig pontosan azt, amit egy eszköz most kapna.
