-- migrate:up

ALTER TABLE public.bot_topic_catalog
  ADD COLUMN subareas_json jsonb NOT NULL DEFAULT '[]'::jsonb;

WITH topic_subarea_specs(topic_id, expected_count, position, subarea_id, keywords_en, keywords_de, keywords_es, keywords_it, keywords_pl) AS (
  VALUES
    ('apartment', 6, 0, 'district', '["district","neighbourhood","area","city centre","suburb"]'::jsonb, '["viertel","gegend","wohngegend","lage","zentrum"]'::jsonb, '["barrio","zona","área","centro","afueras"]'::jsonb, '["quartiere","zona","centro","periferia"]'::jsonb, '["dzielnica","okolica","rejon","centrum","przedmieścia"]'::jsonb),
    ('apartment', 6, 1, 'rent', '["rent","price","monthly","deposit","cheap","expensive"]'::jsonb, '["miete","preis","monatlich","kaution","günstig","teuer"]'::jsonb, '["alquiler","precio","mensual","depósito","barato","caro"]'::jsonb, '["affitto","prezzo","mensile","cauzione","economico","costoso"]'::jsonb, '["czynsz","wynajem","cena","miesięcznie","kaucja","tani","drogi"]'::jsonb),
    ('apartment', 6, 2, 'rooms', '["room","bedroom","living room","kitchen","bathroom","balcony"]'::jsonb, '["zimmer","schlafzimmer","wohnzimmer","küche","bad","balkon"]'::jsonb, '["habitación","dormitorio","salón","cocina","baño","balcón"]'::jsonb, '["stanza","camera","soggiorno","cucina","bagno","balcone"]'::jsonb, '["pokój","sypialnia","salon","kuchnia","łazienka","balkon"]'::jsonb),
    ('apartment', 6, 3, 'furniture', '["furniture","furnished","unfurnished","bed","sofa","table","wardrobe"]'::jsonb, '["möbel","möbliert","unmöbliert","bett","sofa","tisch","schrank"]'::jsonb, '["muebles","amueblado","sin amueblar","cama","sofá","mesa","armario"]'::jsonb, '["mobili","ammobiliato","non ammobiliato","letto","divano","tavolo","armadio"]'::jsonb, '["meble","umeblowane","nieumeblowane","łóżko","sofa","stół","szafa"]'::jsonb),
    ('apartment', 6, 4, 'utilities', '["utilities","bills","electricity","heating","water","internet"]'::jsonb, '["nebenkosten","rechnung","strom","heizung","wasser","internet"]'::jsonb, '["facturas","gastos","electricidad","calefacción","agua","internet"]'::jsonb, '["bollette","spese","elettricità","riscaldamento","acqua","internet"]'::jsonb, '["rachunki","opłaty","prąd","ogrzewanie","woda","internet"]'::jsonb),
    ('apartment', 6, 5, 'transport', '["transport","bus","metro","tram","station","commute"]'::jsonb, '["verkehr","transport","u-bahn","bus","tram","bahnhof","arbeitsweg"]'::jsonb, '["transporte","metro","autobús","tranvía","estación","trayecto"]'::jsonb, '["trasporti","metro","autobus","tram","stazione","tragitto"]'::jsonb, '["transport","metro","autobus","tramwaj","stacja","dojazd"]'::jsonb),

    ('coffee', 5, 0, 'drink-type', '["coffee","cappuccino","latte","espresso","tea"]'::jsonb, '["kaffee","cappuccino","latte","espresso","tee"]'::jsonb, '["café","capuchino","latte","espresso","té"]'::jsonb, '["caffè","cappuccino","latte","espresso","tè"]'::jsonb, '["kawa","cappuccino","latte","espresso","herbata"]'::jsonb),
    ('coffee', 5, 1, 'size', '["small","medium","large"]'::jsonb, '["klein","mittel","groß"]'::jsonb, '["pequeño","mediano","grande"]'::jsonb, '["piccolo","medio","grande"]'::jsonb, '["mała","średnia","duża"]'::jsonb),
    ('coffee', 5, 2, 'milk-sugar', '["milk","oat milk","soy milk","sugar","sweetener"]'::jsonb, '["milch","hafermilch","sojamilch","zucker","süßstoff"]'::jsonb, '["leche","leche de avena","leche de soja","azúcar","edulcorante"]'::jsonb, '["latte","latte di avena","latte di soia","zucchero","dolcificante"]'::jsonb, '["mleko","mleko owsiane","mleko sojowe","cukier","słodzik"]'::jsonb),
    ('coffee', 5, 3, 'snack', '["snack","cake","cookie","croissant","sandwich"]'::jsonb, '["snack","kuchen","keks","croissant","sandwich"]'::jsonb, '["tentempié","pastel","galleta","cruasán","bocadillo"]'::jsonb, '["snack","torta","biscotto","cornetto","panino"]'::jsonb, '["przekąska","ciasto","ciastko","croissant","kanapka"]'::jsonb),
    ('coffee', 5, 4, 'payment', '["cash","card","pay","receipt"]'::jsonb, '["bar","karte","bezahlen","quittung"]'::jsonb, '["efectivo","tarjeta","pagar","recibo"]'::jsonb, '["contanti","carta","pagare","scontrino"]'::jsonb, '["gotówka","karta","płacić","paragon"]'::jsonb),

    ('interview', 4, 0, 'experience', '["experience","background","project","role","job","worked"]'::jsonb, '["erfahrung","hintergrund","projekt","rolle","job","gearbeitet"]'::jsonb, '["experiencia","trayectoria","proyecto","puesto","trabajo"]'::jsonb, '["esperienza","percorso","progetto","ruolo","lavoro"]'::jsonb, '["doświadczenie","projekt","rola","praca","stanowisko"]'::jsonb),
    ('interview', 4, 1, 'skills', '["skill","skills","backend","frontend","tool","communication","teamwork"]'::jsonb, '["fähigkeit","fähigkeiten","backend","frontend","tool","kommunikation","teamarbeit"]'::jsonb, '["habilidad","habilidades","backend","frontend","herramienta","comunicación","trabajo en equipo"]'::jsonb, '["competenza","competenze","backend","frontend","strumento","comunicazione","lavoro di squadra"]'::jsonb, '["umiejętność","umiejętności","backend","frontend","narzędzie","komunikacja","praca zespołowa"]'::jsonb),
    ('interview', 4, 2, 'strengths', '["strength","strengths","reliable","organised","creative","problem-solving"]'::jsonb, '["stärke","stärken","zuverlässig","organisiert","kreativ","problemlösung"]'::jsonb, '["fortaleza","fortalezas","responsable","organizado","creativo","resolver problemas"]'::jsonb, '["punto di forza","punti di forza","affidabile","organizzato","creativo","risolvere problemi"]'::jsonb, '["mocna strona","mocne strony","rzetelny","zorganizowany","kreatywny","rozwiązywanie problemów"]'::jsonb),
    ('interview', 4, 3, 'motivation', '["motivation","interested","role","company","learn","grow","career"]'::jsonb, '["motivation","interessiert","rolle","unternehmen","lernen","wachsen","karriere"]'::jsonb, '["motivación","interesa","puesto","empresa","aprender","crecer","carrera"]'::jsonb, '["motivazione","interessa","ruolo","azienda","imparare","crescere","carriera"]'::jsonb, '["motywacja","interesuje","rola","firma","uczyć się","rozwijać","kariera"]'::jsonb),

    ('routine', 5, 0, 'morning', '["morning","wake up","breakfast","early"]'::jsonb, '["morgen","aufstehen","frühstück","früh"]'::jsonb, '["mañana","despertarse","desayuno","temprano"]'::jsonb, '["mattina","svegliarsi","colazione","presto"]'::jsonb, '["rano","budzić się","śniadanie","wcześnie"]'::jsonb),
    ('routine', 5, 1, 'work-study', '["work","study","office","class","schedule"]'::jsonb, '["arbeit","studium","büro","unterricht","plan"]'::jsonb, '["trabajo","estudio","oficina","clase","horario"]'::jsonb, '["lavoro","studio","ufficio","lezione","programma"]'::jsonb, '["praca","nauka","biuro","zajęcia","plan"]'::jsonb),
    ('routine', 5, 2, 'meals', '["lunch","dinner","meal","cook","eat"]'::jsonb, '["mittagessen","abendessen","mahlzeit","kochen","essen"]'::jsonb, '["almuerzo","cena","comida","cocinar","comer"]'::jsonb, '["pranzo","cena","pasto","cucinare","mangiare"]'::jsonb, '["obiad","kolacja","posiłek","gotować","jeść"]'::jsonb),
    ('routine', 5, 3, 'free-time', '["free time","hobby","gym","friends","relax"]'::jsonb, '["freizeit","hobby","fitnessstudio","freunde","entspannen"]'::jsonb, '["tiempo libre","afición","gimnasio","amigos","relajarse"]'::jsonb, '["tempo libero","hobby","palestra","amici","rilassarsi"]'::jsonb, '["wolny czas","hobby","siłownia","przyjaciele","odpoczywać"]'::jsonb),
    ('routine', 5, 4, 'evening', '["evening","night","sleep","before bed"]'::jsonb, '["abend","nacht","schlafen","vor dem schlafen"]'::jsonb, '["noche","dormir","antes de dormir"]'::jsonb, '["sera","notte","dormire","prima di dormire"]'::jsonb, '["wieczór","noc","spać","przed snem"]'::jsonb),

    ('movies', 5, 0, 'genre', '["genre","comedy","drama","thriller","action"]'::jsonb, '["genre","komödie","drama","thriller","action"]'::jsonb, '["género","comedia","drama","thriller","acción"]'::jsonb, '["genere","commedia","dramma","thriller","azione"]'::jsonb, '["gatunek","komedia","dramat","thriller","akcja"]'::jsonb),
    ('movies', 5, 1, 'plot', '["plot","story","ending","scene"]'::jsonb, '["handlung","geschichte","ende","szene"]'::jsonb, '["trama","historia","final","escena"]'::jsonb, '["trama","storia","finale","scena"]'::jsonb, '["fabuła","historia","zakończenie","scena"]'::jsonb),
    ('movies', 5, 2, 'characters', '["character","actor","actress","hero","villain"]'::jsonb, '["figur","schauspieler","schauspielerin","held","bösewicht"]'::jsonb, '["personaje","actor","actriz","héroe","villano"]'::jsonb, '["personaggio","attore","attrice","eroe","cattivo"]'::jsonb, '["postać","aktor","aktorka","bohater","czarny charakter"]'::jsonb),
    ('movies', 5, 3, 'opinion', '["like","love","boring","funny","favourite"]'::jsonb, '["mögen","lieben","langweilig","lustig","lieblings"]'::jsonb, '["gustar","encantar","aburrido","divertido","favorito"]'::jsonb, '["piacere","amare","noioso","divertente","preferito"]'::jsonb, '["lubić","kochać","nudny","śmieszny","ulubiony"]'::jsonb),
    ('movies', 5, 4, 'recommendations', '["recommend","watch","must-see","again"]'::jsonb, '["empfehlen","anschauen","sehenswert","noch einmal"]'::jsonb, '["recomendar","ver","imprescindible","otra vez"]'::jsonb, '["consigliare","guardare","da vedere","di nuovo"]'::jsonb, '["polecać","obejrzeć","warto zobaczyć","jeszcze raz"]'::jsonb)
),
built_subareas AS (
  SELECT
    catalog.id,
    jsonb_agg(
      jsonb_build_object(
        'id', spec.subarea_id,
        'label_base', catalog.allowed_base ->> spec.position,
        'keywords_target',
          CASE split_part(catalog.bot_key, '-', 2)
            WHEN 'en' THEN spec.keywords_en
            WHEN 'de' THEN spec.keywords_de
            WHEN 'es' THEN spec.keywords_es
            WHEN 'it' THEN spec.keywords_it
            WHEN 'pl' THEN spec.keywords_pl
            ELSE '[]'::jsonb
          END,
        'keywords_base',
          CASE
            WHEN COALESCE(catalog.allowed_base ->> spec.position, '') <> ''
              THEN jsonb_build_array(catalog.allowed_base ->> spec.position)
            ELSE '[]'::jsonb
          END
      )
      ORDER BY spec.position
    ) AS built_subareas_json
  FROM public.bot_topic_catalog AS catalog
  JOIN topic_subarea_specs AS spec
    ON spec.topic_id = catalog.topic_id
  WHERE catalog.topic_id IN ('apartment', 'coffee', 'interview', 'routine', 'movies')
    AND catalog.subareas_json = '[]'::jsonb
    AND split_part(catalog.bot_key, '-', 2) IN ('en', 'de', 'es', 'it', 'pl')
    AND jsonb_typeof(catalog.allowed_base) = 'array'
    AND jsonb_array_length(catalog.allowed_base) = spec.expected_count
  GROUP BY catalog.id
)
UPDATE public.bot_topic_catalog AS catalog
SET subareas_json = built_subareas.built_subareas_json
FROM built_subareas
WHERE catalog.id = built_subareas.id;

UPDATE public.bot_topic_catalog
SET lexical_anchors_target = CASE
      WHEN lexical_anchors_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["rent","furnished","unfurnished","bedroom","balcony","bills","transport"]'::jsonb
          WHEN 'de' THEN '["miete","möbliert","unmöbliert","schlafzimmer","balkon","nebenkosten","verkehr"]'::jsonb
          WHEN 'es' THEN '["alquiler","amueblado","sin amueblar","dormitorio","balcón","facturas","transporte"]'::jsonb
          WHEN 'it' THEN '["affitto","ammobiliato","non ammobiliato","camera","balcone","bollette","trasporti"]'::jsonb
          WHEN 'pl' THEN '["czynsz","umeblowane","nieumeblowane","sypialnia","balkon","rachunki","transport"]'::jsonb
          ELSE lexical_anchors_target
        END
      ELSE lexical_anchors_target
    END,
    bridge_patterns_target = CASE
      WHEN bridge_patterns_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["What about the rent?","And how is the area?","How about the transport links?"]'::jsonb
          WHEN 'de' THEN '["Wie ist die Miete?","Und wie ist die Gegend?","Wie sind die Verkehrsanbindungen?"]'::jsonb
          WHEN 'es' THEN '["¿Qué tal el alquiler?","¿Y cómo es la zona?","¿Cómo es el transporte?"]'::jsonb
          WHEN 'it' THEN '["Com''è l''affitto?","E com''è la zona?","Come sono i trasporti?"]'::jsonb
          WHEN 'pl' THEN '["A jak z czynszem?","A jaka jest okolica?","Jak wygląda dojazd?"]'::jsonb
          ELSE bridge_patterns_target
        END
      ELSE bridge_patterns_target
    END,
    grammar_targets_json = CASE
      WHEN grammar_targets_json = '{}'::jsonb THEN
        '{"focus":["there is / there are","have / has","would like","questions about features"]}'::jsonb
      ELSE grammar_targets_json
    END,
    starter_questions_by_level_target =
      (CASE
        WHEN starter_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(starter_questions_target, '[]'::jsonb))
        ELSE starter_questions_by_level_target
      END)
      || CASE
        WHEN starter_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Is the flat in the city centre or outside it?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Liegt die Wohnung im Zentrum oder eher außerhalb?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿El piso está en el centro o fuera?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["L''appartamento è in centro o fuori?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Czy mieszkanie jest w centrum czy poza nim?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN starter_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["What matters most to you when you choose a flat?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Was ist dir am wichtigsten, wenn du eine Wohnung auswählst?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Qué es lo más importante para ti cuando eliges un piso?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Che cosa conta di più per te quando scegli un appartamento?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Co jest dla ciebie najważniejsze, gdy wybierasz mieszkanie?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    recovery_questions_by_level_target =
      (CASE
        WHEN recovery_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(recovery_questions_target, '[]'::jsonb))
        ELSE recovery_questions_by_level_target
      END)
      || CASE
        WHEN recovery_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Does the flat have one bedroom or more?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Hat die Wohnung ein Schlafzimmer oder mehr?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿El piso tiene un dormitorio o más?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["L''appartamento ha una camera da letto o più?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Czy mieszkanie ma jedną sypialnię czy więcej?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN recovery_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["Would you pay more for a better area or save money on rent?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Würdest du für eine bessere Gegend mehr zahlen oder lieber bei der Miete sparen?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Pagarías más por una mejor zona o preferirías ahorrar en el alquiler?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Pagheresti di più per una zona migliore o preferiresti risparmiare sull''affitto?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Wolał(a)byś zapłacić więcej za lepszą okolicę czy oszczędzić na czynszu?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    opening_prompt_target = CASE
      WHEN BTRIM(opening_prompt_target) = '' THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN 'What matters most to you when you choose a flat?'
          WHEN 'de' THEN 'Was ist dir am wichtigsten, wenn du eine Wohnung auswählst?'
          WHEN 'es' THEN '¿Qué es lo más importante para ti cuando eliges un piso?'
          WHEN 'it' THEN 'Che cosa conta di più per te quando scegli un appartamento?'
          WHEN 'pl' THEN 'Co jest dla ciebie najważniejsze, gdy wybierasz mieszkanie?'
          ELSE opening_prompt_target
        END
      ELSE opening_prompt_target
    END
WHERE topic_id = 'apartment'
  AND split_part(bot_key, '-', 2) IN ('en', 'de', 'es', 'it', 'pl');

UPDATE public.bot_topic_catalog
SET lexical_anchors_target = CASE
      WHEN lexical_anchors_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["cappuccino","latte","oat milk","small","medium","large","cash","card"]'::jsonb
          WHEN 'de' THEN '["cappuccino","latte","hafermilch","klein","mittel","groß","bar","karte"]'::jsonb
          WHEN 'es' THEN '["capuchino","latte","leche de avena","pequeño","mediano","grande","efectivo","tarjeta"]'::jsonb
          WHEN 'it' THEN '["cappuccino","latte","latte di avena","piccolo","medio","grande","contanti","carta"]'::jsonb
          WHEN 'pl' THEN '["cappuccino","latte","mleko owsiane","mała","średnia","duża","gotówka","karta"]'::jsonb
          ELSE lexical_anchors_target
        END
      ELSE lexical_anchors_target
    END,
    bridge_patterns_target = CASE
      WHEN bridge_patterns_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["What size would you like?","Would you like anything to eat as well?","How would you like to pay?"]'::jsonb
          WHEN 'de' THEN '["Welche Größe möchtest du?","Möchtest du auch etwas essen?","Wie möchtest du bezahlen?"]'::jsonb
          WHEN 'es' THEN '["¿Qué tamaño quieres?","¿Quieres también algo para comer?","¿Cómo quieres pagar?"]'::jsonb
          WHEN 'it' THEN '["Che dimensione vuoi?","Vuoi anche qualcosa da mangiare?","Come vuoi pagare?"]'::jsonb
          WHEN 'pl' THEN '["Jaki rozmiar chcesz?","Chcesz też coś do jedzenia?","Jak chcesz zapłacić?"]'::jsonb
          ELSE bridge_patterns_target
        END
      ELSE bridge_patterns_target
    END,
    grammar_targets_json = CASE
      WHEN grammar_targets_json = '{}'::jsonb THEN
        '{"focus":["polite requests","can I have","would like","order details"]}'::jsonb
      ELSE grammar_targets_json
    END,
    starter_questions_by_level_target =
      (CASE
        WHEN starter_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(starter_questions_target, '[]'::jsonb))
        ELSE starter_questions_by_level_target
      END)
      || CASE
        WHEN starter_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Would you like a small coffee or a large one?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Möchtest du einen kleinen Kaffee oder einen großen?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿Quieres un café pequeño o uno grande?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["Vuoi un caffè piccolo o grande?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Chcesz małą kawę czy dużą?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN starter_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["How do you usually customise your coffee order?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Wie passt du deine Kaffeebestellung normalerweise an?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Cómo sueles personalizar tu pedido de café?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Come personalizzi di solito il tuo ordine di caffè?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Jak zwykle dopasowujesz swoje zamówienie na kawę?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    recovery_questions_by_level_target =
      (CASE
        WHEN recovery_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(recovery_questions_target, '[]'::jsonb))
        ELSE recovery_questions_by_level_target
      END)
      || CASE
        WHEN recovery_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Do you take milk or sugar in your coffee?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Nimmst du Milch oder Zucker in deinen Kaffee?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿Tomas leche o azúcar en tu café?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["Prendi latte o zucchero nel caffè?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Bierzesz mleko albo cukier do kawy?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN recovery_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["What snack would go best with that drink?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Welcher Snack würde am besten zu diesem Getränk passen?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Qué tentempié iría mejor con esa bebida?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Quale snack starebbe meglio con quella bevanda?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Jaka przekąska najlepiej pasowałaby do tego napoju?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    opening_prompt_target = CASE
      WHEN BTRIM(opening_prompt_target) = '' THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN 'What kind of coffee would you like today?'
          WHEN 'de' THEN 'Welche Art von Kaffee möchtest du heute?'
          WHEN 'es' THEN '¿Qué tipo de café te gustaría hoy?'
          WHEN 'it' THEN 'Che tipo di caffè vorresti oggi?'
          WHEN 'pl' THEN 'Jaką kawę chcesz dziś zamówić?'
          ELSE opening_prompt_target
        END
      ELSE opening_prompt_target
    END
WHERE topic_id = 'coffee'
  AND split_part(bot_key, '-', 2) IN ('en', 'de', 'es', 'it', 'pl');

UPDATE public.bot_topic_catalog
SET lexical_anchors_target = CASE
      WHEN lexical_anchors_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["experience","project","team","challenge","role","skill","backend","frontend"]'::jsonb
          WHEN 'de' THEN '["erfahrung","projekt","team","herausforderung","rolle","fähigkeit","backend","frontend"]'::jsonb
          WHEN 'es' THEN '["experiencia","proyecto","equipo","reto","puesto","habilidad","backend","frontend"]'::jsonb
          WHEN 'it' THEN '["esperienza","progetto","team","sfida","ruolo","competenza","backend","frontend"]'::jsonb
          WHEN 'pl' THEN '["doświadczenie","projekt","zespół","wyzwanie","rola","umiejętność","backend","frontend"]'::jsonb
          ELSE lexical_anchors_target
        END
      ELSE lexical_anchors_target
    END,
    bridge_patterns_target = CASE
      WHEN bridge_patterns_target = '[]'::jsonb THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '["Could you give a concrete example?","What did you learn from that experience?","Why does that matter for this role?"]'::jsonb
          WHEN 'de' THEN '["Kannst du ein konkretes Beispiel geben?","Was hast du aus dieser Erfahrung gelernt?","Warum ist das für diese Rolle wichtig?"]'::jsonb
          WHEN 'es' THEN '["¿Puedes dar un ejemplo concreto?","¿Qué aprendiste de esa experiencia?","¿Por qué es importante para este puesto?"]'::jsonb
          WHEN 'it' THEN '["Puoi fare un esempio concreto?","Che cosa hai imparato da quell''esperienza?","Perché è importante per questo ruolo?"]'::jsonb
          WHEN 'pl' THEN '["Czy możesz podać konkretny przykład?","Czego nauczyłeś(-aś) się z tego doświadczenia?","Dlaczego to jest ważne w tej roli?"]'::jsonb
          ELSE bridge_patterns_target
        END
      ELSE bridge_patterns_target
    END,
    grammar_targets_json = CASE
      WHEN grammar_targets_json = '{}'::jsonb THEN
        '{"focus":["past simple","present perfect","because / so","confident explanations"]}'::jsonb
      ELSE grammar_targets_json
    END,
    starter_questions_by_level_target =
      (CASE
        WHEN starter_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(starter_questions_target, '[]'::jsonb))
        ELSE starter_questions_by_level_target
      END)
      || CASE
        WHEN starter_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Can you tell me about your last job or project?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Kannst du mir von deiner letzten Arbeit oder deinem letzten Projekt erzählen?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿Puedes contarme sobre tu último trabajo o proyecto?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["Puoi parlarmi del tuo ultimo lavoro o progetto?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Czy możesz opowiedzieć o swojej ostatniej pracy albo projekcie?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN starter_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["What experience makes you a strong fit for this role?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Welche Erfahrung macht dich zu einer guten Besetzung für diese Rolle?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Qué experiencia te hace una buena opción para este puesto?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Quale esperienza ti rende adatto a questo ruolo?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Jakie doświadczenie sprawia, że dobrze pasujesz do tej roli?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    recovery_questions_by_level_target =
      (CASE
        WHEN recovery_questions_by_level_target = '{}'::jsonb
          THEN jsonb_build_object('default', COALESCE(recovery_questions_target, '[]'::jsonb))
        ELSE recovery_questions_by_level_target
      END)
      || CASE
        WHEN recovery_questions_by_level_target ? 'a1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"a1":["Which skill do you use most at work?"]}'::jsonb
          WHEN 'de' THEN '{"a1":["Welche Fähigkeit nutzt du bei der Arbeit am meisten?"]}'::jsonb
          WHEN 'es' THEN '{"a1":["¿Qué habilidad usas más en el trabajo?"]}'::jsonb
          WHEN 'it' THEN '{"a1":["Quale competenza usi di più al lavoro?"]}'::jsonb
          WHEN 'pl' THEN '{"a1":["Której umiejętności używasz najczęściej w pracy?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END
      || CASE
        WHEN recovery_questions_by_level_target ? 'b1' THEN '{}'::jsonb
        ELSE CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN '{"b1":["Why does this role interest you now?"]}'::jsonb
          WHEN 'de' THEN '{"b1":["Warum interessiert dich diese Rolle gerade jetzt?"]}'::jsonb
          WHEN 'es' THEN '{"b1":["¿Por qué te interesa este puesto ahora?"]}'::jsonb
          WHEN 'it' THEN '{"b1":["Perché ti interessa questo ruolo proprio adesso?"]}'::jsonb
          WHEN 'pl' THEN '{"b1":["Dlaczego ta rola interesuje cię właśnie teraz?"]}'::jsonb
          ELSE '{}'::jsonb
        END
      END,
    opening_prompt_target = CASE
      WHEN BTRIM(opening_prompt_target) = '' THEN
        CASE split_part(bot_key, '-', 2)
          WHEN 'en' THEN 'Tell me about the experience that prepared you for this role.'
          WHEN 'de' THEN 'Erzähl mir von der Erfahrung, die dich auf diese Rolle vorbereitet hat.'
          WHEN 'es' THEN 'Cuéntame qué experiencia te preparó para este puesto.'
          WHEN 'it' THEN 'Parlami dell''esperienza che ti ha preparato a questo ruolo.'
          WHEN 'pl' THEN 'Opowiedz mi o doświadczeniu, które przygotowało cię do tej roli.'
          ELSE opening_prompt_target
        END
      ELSE opening_prompt_target
    END
WHERE topic_id = 'interview'
  AND split_part(bot_key, '-', 2) IN ('en', 'de', 'es', 'it', 'pl');

-- migrate:down

ALTER TABLE public.bot_topic_catalog
  DROP COLUMN IF EXISTS subareas_json;
