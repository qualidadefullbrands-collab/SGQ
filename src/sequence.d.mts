export type SequenceInspection={status:string,parametros_amostragem?:{
  lote_sequencial?:string|null;ordem_produto?:number;total_produtos?:number
}|null}
export declare function sequentialProductInfo<T extends SequenceInspection>(
  inspection:T, all:T[]
):{blocked:boolean;order:number;total:number;previous:T|null}
