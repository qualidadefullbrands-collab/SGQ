export type RqCode = 'RQ014' | 'RQ015' | 'RQ016' | 'RQ016B'

export type AuditCriterion = {
  key: string
  label: string
  section: string
}

export type AuditDefinition = {
  code: RqCode
  displayCode: string
  title: string
  version: string
  description: string
  requiresPhoto: boolean
  fixedChecklist: boolean
  criteria: AuditCriterion[]
  photoHint?: string
}

const rq014: AuditDefinition = {
  code: 'RQ014',
  displayCode: 'RQ 014',
  title: 'Inspeção Mensal de Extintores e Hidrantes',
  version: '02/2026',
  description: 'Inspeção mensal dos equipamentos de combate a incêndio.',
  requiresPhoto: true,
  fixedChecklist: false,
  photoHint: 'Fotografe a não conformidade quando aplicável.',
  criteria: [
    { key:'E1', section:'Extintores', label:'Sinalização de parede e de piso visível' },
    { key:'E2', section:'Extintores', label:'Acesso livre e desobstruído' },
    { key:'E3', section:'Extintores', label:'No suporte, no local e na altura corretos' },
    { key:'E4', section:'Extintores', label:'Lacre e pino de segurança presentes' },
    { key:'E5', section:'Extintores', label:'Manômetro na faixa verde (NA para CO2)' },
    { key:'E6', section:'Extintores', label:'Mangueira, difusor e bico íntegros' },
    { key:'E7', section:'Extintores', label:'Casco sem amassado, corrosão ou vazamento' },
    { key:'E8', section:'Extintores', label:'Recarga dentro da validade' },
    { key:'E9', section:'Extintores', label:'Teste hidrostático dentro da validade' },
    { key:'H1', section:'Hidrantes e abrigos', label:'Sinalização de parede e de piso visível' },
    { key:'H2', section:'Hidrantes e abrigos', label:'Acesso livre e desobstruído' },
    { key:'H3', section:'Hidrantes e abrigos', label:'Abrigo íntegro, com porta abrindo e fechando' },
    { key:'H4', section:'Hidrantes e abrigos', label:'Mangueira presente, acondicionada e sem danos' },
    { key:'H5', section:'Hidrantes e abrigos', label:'Esguicho e chave storz presentes' },
    { key:'H6', section:'Hidrantes e abrigos', label:'Registro sem vazamento' },
    { key:'H7', section:'Hidrantes e abrigos', label:'Acionador de alarme íntegro e sinalizado' },
  ],
}

const rq015: AuditDefinition = {
  code: 'RQ015',
  displayCode: 'RQ 015',
  title: 'Checklist Mensal de Porta-Paletes',
  version: '02/2026',
  description: 'Inspeção mensal da estrutura de porta-paletes por rua/endereço.',
  requiresPhoto: true,
  fixedChecklist: false,
  photoHint: 'Inclua foto do achado estrutural sempre que houver evidência visual.',
  criteria: [
    { key:'P1', section:'Porta-paletes', label:'Placa de carga visível e legível' },
    { key:'P2', section:'Porta-paletes', label:'Carga dentro da capacidade indicada' },
    { key:'P3', section:'Porta-paletes', label:'Longarinas sem deformação ou torção' },
    { key:'P4', section:'Porta-paletes', label:'Travamentos e pinos de segurança presentes' },
    { key:'P5', section:'Porta-paletes', label:'Montantes sem impacto ou amassamento' },
    { key:'P6', section:'Porta-paletes', label:'Diagonais e contraventamentos íntegros' },
    { key:'P7', section:'Porta-paletes', label:'Chumbadores e sapatas fixos' },
    { key:'P8', section:'Porta-paletes', label:'Protetores de coluna íntegros' },
    { key:'P9', section:'Porta-paletes', label:'Estrutura alinhada, nivelada e no prumo' },
    { key:'P10', section:'Porta-paletes', label:'Piso e base sem trincas ou recalque' },
    { key:'P11', section:'Porta-paletes', label:'Sem corrosão ou pintura comprometida' },
    { key:'P12', section:'Porta-paletes', label:'Paletes íntegros e bem posicionados' },
    { key:'P13', section:'Porta-paletes', label:'Corredor e acesso livres' },
  ],
}

const rq016: AuditDefinition = {
  code: 'RQ016',
  displayCode: 'RQ 016',
  title: 'Avaliação 5S',
  version: '02/2026',
  description: 'Avaliação 5S completa com 30 itens C / NC / NA.',
  requiresPhoto: true,
  fixedChecklist: true,
  photoHint: 'Use fotos para evidenciar as não conformidades e situações relevantes.',
  criteria: [
    { key:'1', section:'Utilização', label:'Corredores e posições de armazenagem estão livres de materiais sem uso, sucata ou itens sem identificação?' },
    { key:'2', section:'Utilização', label:'Equipamentos, mobiliário e materiais sem utilidade operacional estão em área de descarte identificada?' },
    { key:'3', section:'Utilização', label:'Todos os objetos e equipamentos estão sendo utilizados para a finalidade correta?' },
    { key:'4', section:'Utilização', label:'Piso, teto, lâmpadas, paredes e instalações gerais estão em boas condições de conservação?' },
    { key:'5', section:'Ordenação', label:'Insumos de embalagem, caixas e materiais de apoio possuem local fixo definido e identificado?' },
    { key:'6', section:'Ordenação', label:'Equipamentos de movimentação possuem local fixo definido e identificado?' },
    { key:'7', section:'Ordenação', label:'A estação de trabalho (check-out) está organizada e livre de itens sem relação com a atividade?' },
    { key:'8', section:'Ordenação', label:'Pallets com status diferente de liberado (amostragem WMS) estão com identificação visual visível?' },
    { key:'9', section:'Ordenação', label:'Saídas de emergência, rotas de fuga e extintores estão sinalizados e desobstruídos?' },
    { key:'10', section:'Ordenação', label:'As lixeiras estão identificadas por tipo de resíduo e nos locais definidos?' },
    { key:'11', section:'Limpeza', label:'O piso do armazém está limpo e livre de resíduos soltos?' },
    { key:'12', section:'Limpeza', label:'Equipamentos de movimentação estão limpos e sem acúmulo de resíduos?' },
    { key:'13', section:'Limpeza', label:'A área interna está livre de evidências de pragas, insetos ou roedores?' },
    { key:'14', section:'Limpeza', label:'Materiais de limpeza estão armazenados em local identificado e separados de materiais operacionais?' },
    { key:'15', section:'Segurança', label:'Os colaboradores observados estão com sapato de segurança e, no caso de operadores de empilhadeira, com capacete?' },
    { key:'16', section:'Segurança', label:'A área está livre de condições ou comportamentos inseguros?' },
    { key:'17', section:'Segurança', label:'A área operacional está livre de alimentos, bebidas e objetos pessoais fora dos locais designados?' },
    { key:'18', section:'Disciplina', label:'Os colaboradores abordados conhecem as boas práticas do programa e sua aplicação na área?' },
    { key:'19', section:'Disciplina', label:'O padrão de organização e limpeza está sendo mantido fora do período de auditoria?' },
    { key:'20', section:'Área externa', label:'A área externa está livre de materiais em desuso, sucata ou itens sem destinação definida?' },
    { key:'21', section:'Área externa', label:'O pátio e as docas estão organizados e livres de itens fora do lugar?' },
    { key:'22', section:'Área externa', label:'A área externa está limpa e livre de resíduos no chão?' },
    { key:'23', section:'Área externa', label:'Cercas, muros, bueiros, tampas e pisos externos estão em boas condições de conservação?' },
    { key:'24', section:'Área externa', label:'Os acessos de emergência e rotas de saída externas estão livres e desobstruídos?' },
    { key:'25', section:'Documentação regulatória', label:'O relatório de controle de pragas do mês está arquivado na pasta correta?' },
    { key:'26', section:'Documentação regulatória', label:'O laudo de análise de água está arquivado e dentro da validade?' },
    { key:'27', section:'Documentação regulatória', label:'Os certificados de calibração dos equipamentos rastreáveis estão arquivados e dentro da validade?' },
    { key:'28', section:'Documentação regulatória', label:'O documento de coleta e destinação de resíduos do mês está arquivado com evidência?' },
    { key:'29', section:'Documentação regulatória', label:'O registro de limpeza geral do armazém do mês está atualizado e arquivado?' },
    { key:'30', section:'Documentação regulatória', label:'As tratativas do ciclo anterior foram encerradas dentro do prazo definido?' },
  ],
}

const rq016b: AuditDefinition = {
  code: 'RQ016B',
  displayCode: 'RQ 016-B',
  title: 'Pré-Avaliação 5S',
  version: '01/2026',
  description: 'Pré-avaliação 5S por Ruas, Checkouts e Docas.',
  requiresPhoto: false,
  fixedChecklist: false,
  criteria: [
    { key:'R1', section:'Ruas', label:'Existem itens, pallets, materiais ou embalagens desnecessários ou em excesso nas ruas? (Utilização)' },
    { key:'R2', section:'Ruas', label:'Existem caixas ou embalagens vazias, rasgadas, abertas ou danificadas? (Utilização)' },
    { key:'R3', section:'Ruas', label:'Há itens fora da área de picking ou posicionados incorretamente? (Utilização / Ordenação)' },
    { key:'R4', section:'Ruas', label:'Pallets e cargas estão alinhados e dentro das posições definidas conforme endereçamento? (Ordenação)' },
    { key:'R5', section:'Ruas', label:'Há identificação visível e legível das ruas, prateleiras, bins e posições de estoque? (Ordenação)' },
    { key:'R6', section:'Ruas', label:'Etiquetas e identificações estão atualizadas, legíveis e sem sobreposição de etiquetas antigas? (Ordenação)' },
    { key:'R7', section:'Ruas', label:'Ferramentas, materiais de limpeza e equipamentos estão armazenados corretamente em local identificado? (Ordenação / Autodisciplina)' },
    { key:'R8', section:'Ruas', label:'Corredores e áreas de circulação estão livres, desobstruídos e com sinalização de solo visível e respeitada? (Ordenação / Segurança)' },
    { key:'R9', section:'Ruas', label:'Piso, paredes, teto, prateleiras e áreas de picking estão limpos, íntegros e em bom estado de conservação? (Limpeza / Conservação)' },
    { key:'R10', section:'Ruas', label:'Não há papéis, detritos, resíduos ou sujeira acumulada no chão ou nos bins? (Limpeza)' },
    { key:'R11', section:'Ruas', label:'A equipe utiliza corretamente os EPI’s obrigatórios (calçado, capacete, uniforme) e mantém higiene pessoal adequada? (Bem-estar / Segurança)' },
    { key:'R12', section:'Ruas', label:'Iluminação, ventilação e condições ergonômicas estão adequadas (sem lâmpadas queimadas, temperatura e conforto adequados)? (Bem-estar)' },
    { key:'R13', section:'Ruas', label:'Extintores e equipamentos de emergência estão acessíveis, identificados e desobstruídos? (Segurança)' },
    { key:'R14', section:'Ruas', label:'A equipe mantém disciplina na organização, limpeza e padronização da área durante todo o turno? (Autodisciplina)' },
    { key:'C1', section:'Checkouts', label:'Existem materiais, embalagens ou equipamentos desnecessários ou em excesso no check-out? (Utilização)' },
    { key:'C2', section:'Checkouts', label:'Há insumos de embalagem, caixas ou ferramentas fora do local correto? (Utilização)' },
    { key:'C3', section:'Checkouts', label:'A parte inferior do check-out está sendo utilizada adequadamente para armazenamento de insumos? (Utilização / Ordenação)' },
    { key:'C4', section:'Checkouts', label:'Bancadas e mesas estão organizadas, livres de acúmulo de materiais e com espaço adequado para o trabalho? (Ordenação)' },
    { key:'C5', section:'Checkouts', label:'Itens em processo (a expedir, conferir, devoluções) estão identificados e separados conforme padrão? (Ordenação)' },
    { key:'C6', section:'Checkouts', label:'Identificações de áreas e estações de trabalho estão visíveis, legíveis e atualizadas? (Ordenação)' },
    { key:'C7', section:'Checkouts', label:'Lixeira está disponível, posicionada corretamente e em bom estado de uso? (Ordenação)' },
    { key:'C8', section:'Checkouts', label:'Piso, bancadas e equipamentos estão limpos, íntegros e em bom estado de conservação? (Limpeza / Conservação)' },
    { key:'C9', section:'Checkouts', label:'Não há resíduos, papéis, plásticos ou restos de fita no chão ou sobre as bancadas? (Limpeza)' },
    { key:'C10', section:'Checkouts', label:'Ferramentas, impressoras e materiais de apoio estão organizados e armazenados após o uso? (Ordenação / Autodisciplina)' },
    { key:'C11', section:'Checkouts', label:'Câmeras estão conectadas e operando corretamente, com visibilidade adequada da área? (Segurança / Autodisciplina)' },
    { key:'C12', section:'Checkouts', label:'A equipe utiliza corretamente os EPI’s obrigatórios (calçado, uniforme, quando aplicável) e mantém boa apresentação pessoal? (Bem-estar / Segurança)' },
    { key:'C13', section:'Checkouts', label:'Iluminação, ventilação e condições ergonômicas estão adequadas (sem lâmpadas queimadas, temperatura e conforto adequados)? (Bem-estar)' },
    { key:'C14', section:'Checkouts', label:'A equipe mantém disciplina na organização, limpeza e padronização da área durante todo o turno? (Autodisciplina)' },
    { key:'D1', section:'Docas', label:'Existem pallets, materiais ou embalagens desnecessários ou em excesso? (Utilização)' },
    { key:'D2', section:'Docas', label:'Há materiais quebrados, obsoletos ou abandonados na área? (Utilização)' },
    { key:'D3', section:'Docas', label:'Equipamentos de movimentação (paleteiras, carrinhos, balanças) são utilizados apenas quando necessário e guardados após o uso? (Utilização / Autodisciplina)' },
    { key:'D4', section:'Docas', label:'Pallets e cargas estão alinhados e posicionados corretamente nas áreas designadas? (Ordenação)' },
    { key:'D5', section:'Docas', label:'Stage e docas estão livres de obstruções e organizados? (Ordenação / Segurança)' },
    { key:'D6', section:'Docas', label:'Identificações de docas e áreas estão visíveis, legíveis e atualizadas? (Ordenação)' },
    { key:'D7', section:'Docas', label:'Linhas, marcações e sinalizações no piso estão visíveis e respeitadas? (Ordenação / Segurança)' },
    { key:'D8', section:'Docas', label:'Lixeira está disponível, posicionada corretamente e em bom estado de uso? (Ordenação)' },
    { key:'D9', section:'Docas', label:'Piso, paredes e portas estão limpos, íntegros e livres de derramamentos ou resíduos? (Limpeza / Conservação)' },
    { key:'D10', section:'Docas', label:'Equipamentos e estruturas da doca (niveladores, defensas, portas) estão limpos e conservados? (Limpeza / Conservação)' },
    { key:'D11', section:'Docas', label:'A equipe utiliza corretamente os EPI’s obrigatórios (calçado, capacete, uniforme) e mantém higiene pessoal adequada? (Bem-estar / Segurança)' },
    { key:'D12', section:'Docas', label:'Iluminação, ventilação e condições ergonômicas estão adequadas (sem lâmpadas queimadas, temperatura e conforto adequados)? (Bem-estar)' },
    { key:'D13', section:'Docas', label:'Extintores e equipamentos de emergência estão acessíveis, identificados e desobstruídos? (Segurança)' },
    { key:'D14', section:'Docas', label:'A equipe mantém disciplina na organização, limpeza e padronização da área durante todo o turno? (Autodisciplina)' },
  ],
}

export const AUDIT_DEFINITIONS: AuditDefinition[] = [rq014, rq015, rq016, rq016b]

export function getAuditDefinition(code: RqCode) {
  return AUDIT_DEFINITIONS.find((x)=>x.code===code)!
}
