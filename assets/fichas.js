/* Litoteca — fichas curadas de las 9 clases del modelo.
 * Los `id` son los mismos que usan las carpetas de data/prepared y el contrato
 * de /api/predict. `gemela` apunta al id de la roca con la que se confunde.
 * Texto deliberadamente breve: el extracto de Wikipedia lo complementa. */
window.LITOTECA_FICHAS = {
  basalt: {
    id: "basalt", nombre: "Basalto", tecnico: "Basalt", origen: "igneo",
    wiki: "Basalto",
    que: "Roca volcánica oscura y de grano tan fino que los cristales no se ven a simple vista. Es la roca ígnea más común de la superficie terrestre.",
    formacion: "Se forma cuando la lava se enfría rápido en superficie: los minerales no tienen tiempo de crecer y quedan como una masa microcristalina.",
    donde: "Coladas volcánicas, islas oceánicas, dorsales y buena parte del fondo marino.",
    usos: "Áridos y balasto de vías, pavimento, lana y fibra de basalto para aislamiento.",
    dato: "Cubre la mayor parte del fondo oceánico: la corteza bajo el mar es, casi toda, basalto.",
    gemela: "olivine-basalt",
    criterio: "Si ves granos verde oliva brillantes del tamaño de una lenteja, es basalto olivínico. El basalto normal es uniforme, sin granos visibles."
  },
  "olivine-basalt": {
    id: "olivine-basalt", nombre: "Basalto olivínico", tecnico: "Olivine basalt", origen: "igneo",
    wiki: "Basalto",
    que: "Basalto que conserva fenocristales de olivino, un mineral verde oliva que aquí se ve a simple vista como puntos o granitos.",
    formacion: "Proviene de magmas primarios, poco evolucionados: el olivino cristalizó en profundidad y la lava lo subió rápido, sin tiempo para reabsorberlo.",
    donde: "Conos monogenéticos, coladas jóvenes y xenolitos arrancados del manto.",
    usos: "Mismo uso que el basalto; los xenolitos son valiosos para estudiar el manto.",
    dato: "El olivino se altera con el agua a iddingsita: un borde rojizo en los granos verdes delata que la muestra lleva tiempo expuesta.",
    gemela: "basalt",
    criterio: "Busca los granos verdes: si están, es olivínico. Si la superficie es homogénea y gris negra, es basalto común."
  },
  chert: {
    id: "chert", nombre: "Sílex", tecnico: "Chert", origen: "sedimentario",
    wiki: "Sílex",
    que: "Roca silícea criptocristalina, muy dura, de fractura concoidal y brillo entre vítreo y céreo.",
    formacion: "La sílice disuelta en el agua precipita en el sedimento, a menudo rellenando cavidades o sustituyendo caliza.",
    donde: "Nódulos y lentejones dentro de calizas, y capas de pedernal en rocas marinas.",
    usos: "Herramientas talladas de la Prehistoria, piedra de chispa, áridos duros.",
    dato: "Al golpearlo con acero da chispas: fue el encendedor de la humanidad antes del fuego por fricción.",
    gemela: "diatomite",
    criterio: "El sílex es duro y vítreo y raya el vidrio; la diatomita es blanda, terrosa y se desmenuza con la uña."
  },
  clay: {
    id: "clay", nombre: "Arcilla", tecnico: "Clay", origen: "sedimentario",
    wiki: "Arcilla",
    que: "Sedimento de grano finísimo (menos de 4 µm) formado por minerales laminares; es plástico cuando está húmedo.",
    formacion: "Nace de la meteorización química de feldespatos y micas; el agua arrastra esos minerales y los deposita en zonas tranquilas.",
    donde: "Llanuras de inundación, fondos de lago, deltas y suelos residuales.",
    usos: "Cerámica y ladrillo, adsorbente industrial, lodo de perforación, cosmética.",
    dato: "Un gramo de arcilla puede tener la superficie de una cancha de fútbol: por eso retiene agua y contaminantes tan bien.",
    gemela: "shale",
    criterio: "Si se amasa y se moldea sin romperse, es arcilla. La lutita ya está litificada: se parte en láminas y no es plástica."
  },
  conglomerate: {
    id: "conglomerate", nombre: "Conglomerado", tecnico: "Conglomerate", origen: "sedimentario",
    wiki: "Conglomerado (geología)",
    que: "Roca sedimentaria formada por cantos redondeados de más de 2 mm cementados entre sí por una matriz más fina.",
    formacion: "El agua transporta grava durante kilómetros, la redondea y la deposita en ríos o abanicos; después un cemento la une.",
    donde: "Cauces fluviales, abanicos aluviales, bases de secuencias y molasas.",
    usos: "Áridos, roca ornamental en muros y fachadas.",
    dato: "Los cantos redondeados son un cronómetro: cuanto más rodados, más largo fue el viaje hasta el lugar donde los encuentras.",
    gemela: "chert",
    criterio: "Se ve a simple vista que está hecho de piedras pegadas. Si los clastos fueran angulosos y no redondeados, sería una brecha."
  },
  diatomite: {
    id: "diatomite", nombre: "Diatomita", tecnico: "Diatomite", origen: "sedimentario",
    wiki: "Diatomita",
    que: "Roca silícea blanca, porosa y muy ligera, compuesta por los esqueletos microscópicos de diatomeas.",
    formacion: "En lagos y mares ricos en sílice, las diatomeas mueren, sus frústulas caen y se acumulan en capas de cientos de metros.",
    donde: "Cuencas lacustres antiguas; yacimientos célebres en EE. UU., Dinamarca y España.",
    usos: "Filtro de cerveza y vino, absorbente, aislamiento, soporte de explosivos y pinturas.",
    dato: "Nobel estabilizó la nitroglicerina empapándola en diatomita: sin esta roca blanda, la dinamita no se habría podido transportar.",
    gemela: "chert",
    criterio: "Pesa poco, mancha los dedos y se rompe como tiza; además no efervece con ácido, porque es sílice y no carbonato."
  },
  gypsum: {
    id: "gypsum", nombre: "Yeso", tecnico: "Gypsum", origen: "sedimentario",
    wiki: "Yeso",
    que: "Sulfato cálcico hidratado, blando (dureza 2) y a menudo blanco, incoloro o algo rosado; puede ser fibroso o sacaroideo.",
    formacion: "Evaporita: el agua de lagunas saladas se evapora y el sulfato precipita junto a la halita.",
    donde: "Cuencas evaporíticas, desiertos, yesares y cuevas; también como venas hidrotermales.",
    usos: "Escayola y placas de construcción, cemento, fertilizante, moldes dentales.",
    dato: "Se raya con la uña. Calcinado pierde agua y se convierte en el yeso de París que fragua con solo añadir agua.",
    gemela: "clay",
    criterio: "El yeso es cristalino y se raya con la uña; la arcilla se pega a los dedos, huele a tierra mojada y se moldea."
  },
  shale: {
    id: "shale", nombre: "Lutita", tecnico: "Shale (mudstone)", origen: "sedimentario",
    wiki: "Lutita",
    que: "Roca sedimentaria de grano fino, litificada, que se parte en láminas finas paralelas (fisilidad).",
    formacion: "El lodo se deposita en aguas tranquilas y se compacta hasta convertirse en roca; la orientación de las arcillas crea las láminas.",
    donde: "Cuencas de antepaís, deltas, taludes y cualquier fondo donde decante el fango.",
    usos: "Lutita bituminosa como fuente de hidrocarburos, materia prima de cerámica y cemento.",
    dato: "Es la roca sedimentaria más abundante del registro geológico: cerca de dos tercios de todas ellas.",
    gemela: "clay",
    criterio: "Si se rompe en hojas duras y suena al golpearla, es lutita. La arcilla se deshace en agua y se moldea."
  },
  "siliceous-sinter": {
    id: "siliceous-sinter", nombre: "Geiserita", tecnico: "Siliceous sinter", origen: "sedimentario",
    wiki: "Geiserita",
    que: "Depósito de sílice opalina que precipita alrededor de surgencias termales y géiseres; suele ser poroso, blanco y en capas.",
    formacion: "El agua caliente profunda disuelve sílice; al salir y enfriarse, la precipita alrededor del brote y forma terrazas y costras.",
    donde: "Campos geotérmicos activos: Yellowstone, El Tatio, Rotorua, surgencias andinas.",
    usos: "Roca ornamental y, sobre todo, indicador de actividad geotérmica pasada.",
    dato: "Crece milímetro a milímetro, así que sus capas guardan un registro de miles de años de actividad del géiser.",
    gemela: "diatomite",
    criterio: "La geiserita está ligada a un brote termal y tiene capas y poros irregulares; la diatomita es una harina blanca uniforme de origen lacustre."
  }
};
